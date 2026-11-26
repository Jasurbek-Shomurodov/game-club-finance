// Keeps each club's Yandex Maps card in step with the app. Yandex Business has
// no API for price lists or reviews, so the Yandex steps are done in the
// owner's signed-in Chrome (docs/runbooks/yandex-maps-sync.md); this script
// does everything else:
//
//   npm run yandex:sync -- plan     YML price list per club (+ diff against current-<orgId>.json)
//                                   and its price cards in cards-<orgId>/ [--card-base-url <url>] [--photo-pictures]
//   npm run yandex:sync -- replies  replies for the unanswered reviews in reviews-<orgId>.json
//   npm run yandex:sync -- report --dry-run | --confirm-send [--resend]
//                                   "AI bot" image per club, sent to the club's Telegram group
//                                   once per business date (sent-<orgId>-<date>.json)
//
// `--club <id>` limits a run to one club. Reads the database with the service
// role (every query filtered by club_id) and writes only under
// artifacts/yandex/ and, for `report --confirm-send`, to Telegram. `plan`
// also loads the club's own showcase images (zone photos, game covers, logo)
// to draw the cards; it fetches nothing else.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createReviewReplyWriter } from '../src/lib/googleBusiness/replyWriter';
import { renderReviewDigestPng, YANDEX_MAPS_DIGEST_SOURCE } from '../src/lib/googleBusiness/reviewDigestImage';
import { targetChatId } from '../src/lib/telegram/clubChat';
import { getClubBusinessDayStartHour, sendTelegramPhoto } from '../src/lib/telegram/sendDailyFinanceReport';
import { serverTodayIso } from '../src/lib/utils';
import { parseYandexSyncArgs, type YandexSyncArgs } from '../src/lib/yandexMaps/cli';
import { generatedAtOf, priceDiffCounts, uploadedPriceCounts, yandexDigestCaption, yandexReportDecision, yandexReviewDigest } from '../src/lib/yandexMaps/digest';
import { yandexOrgId } from '../src/lib/yandexMaps/orgId';
import { gameCoverReport, yandexPriceCards } from '../src/lib/yandexMaps/priceCard';
import { isPriceCardImageUrl, loadPriceCardImage } from '../src/lib/yandexMaps/priceCardAssets';
import { renderPriceCardPng } from '../src/lib/yandexMaps/priceCardImage';
import { buildYandexPriceItems, buildYandexYml, diffPriceList, formatPriceDiff, parsePriceSnapshot, type YandexPriceClub } from '../src/lib/yandexMaps/priceList';
import { buildYandexReplies, parseYandexReplies, parseYandexReviews } from '../src/lib/yandexMaps/reviews';
import type { ShowcaseGame, ShowcaseOffer, ShowcasePcZone } from '../src/types';

const OUTPUT_DIRECTORY = resolve(process.cwd(), 'artifacts', 'yandex');
const SECRET_NAMES = /KEY|SECRET|TOKEN|PASSWORD/i;

function loadLocalEnvironment() {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
    process.env[name] = value;
  }
}

/** An error's message with every secret environment value blanked out. */
function safeMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && SECRET_NAMES.test(name)) message = message.split(value).join('[redacted]');
  }
  return message;
}

const outputPath = (name: string) => resolve(OUTPUT_DIRECTORY, name);

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface SyncClub {
  clubId: string;
  orgId: string;
  clubName: string;
  logoUrl: string | null;
  address: string | null;
  /** The public page; the price cards are served from it only while it is published. */
  slug: string | null;
  published: boolean;
}

/** Every club whose public page links its own Yandex Maps place. */
async function loadClubs(supabase: SupabaseClient, clubId: string | null): Promise<SyncClub[]> {
  let query = supabase.from('club_showcases').select('club_id, yandex_maps_url, address, slug, is_published').not('yandex_maps_url', 'is', null);
  if (clubId) query = query.eq('club_id', clubId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read club_showcases: ${error.message}`);

  const clubs: SyncClub[] = [];
  for (const row of (data ?? []) as Array<{ club_id: string; yandex_maps_url: string | null; address: string | null; slug: string | null; is_published: boolean | null }>) {
    const orgId = yandexOrgId(row.yandex_maps_url);
    if (!orgId) {
      console.warn(`Skipping club ${row.club_id}: its Yandex Maps link has no organisation id`);
      continue;
    }
    const { data: club, error: clubError } = await supabase.from('clubs').select('name, logo_url, address').eq('id', row.club_id).single();
    if (clubError) throw new Error(`Could not read club ${row.club_id}: ${clubError.message}`);
    const record = club as { name: string; logo_url: string | null; address: string | null };
    clubs.push({
      clubId: row.club_id,
      orgId,
      clubName: record.name,
      logoUrl: record.logo_url,
      address: row.address?.trim() || record.address?.trim() || null,
      slug: row.slug?.trim() || null,
      published: row.is_published === true,
    });
  }
  if (!clubs.length) console.warn(clubId ? `Club ${clubId} has no Yandex Maps place` : 'No club has a Yandex Maps place');
  return clubs;
}

/** Draws every item's card into cards-<orgId>/ (emptied first), the same picture the public route serves. */
async function writePriceCards(club: SyncClub, priceClub: YandexPriceClub, items: ReturnType<typeof buildYandexPriceItems>['items'], isCardImage: (url: string) => boolean) {
  const directory = outputPath(`cards-${club.orgId}`);
  mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(directory)) if (file.endsWith('.png')) rmSync(resolve(directory, file));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const images = new Map<string, Promise<Buffer | null>>();
  const load = (url: string | null) => {
    if (!url) return Promise.resolve(null);
    if (!images.has(url)) images.set(url, loadPriceCardImage(url, { supabaseUrl, timeoutMs: 15_000 }));
    return images.get(url)!;
  };
  for (const card of yandexPriceCards(priceClub, items, isCardImage)) {
    const [background, logo] = await Promise.all([load(card.background), load(card.logoUrl)]);
    if (card.background && !background) console.warn(`  card ${card.itemId}: its background did not load, drawn on the gradient`);
    writeFileSync(resolve(directory, `${card.itemId}.png`), await renderPriceCardPng(card, { background, logo }));
  }
  return directory;
}

async function plan(supabase: SupabaseClient, clubs: SyncClub[], args: YandexSyncArgs) {
  const isCardImage = (url: string) => isPriceCardImageUrl(url, process.env.NEXT_PUBLIC_SUPABASE_URL);
  for (const club of clubs) {
    // The public page's order (sort_order, then created_at), so the local cards and category ids
    // are the ones the price-card route serves.
    const [zones, offers, games] = await Promise.all([
      supabase.from('showcase_pc_zones').select('*').eq('club_id', club.clubId).order('sort_order').order('created_at'),
      supabase.from('showcase_offers').select('*').eq('club_id', club.clubId).order('sort_order').order('created_at'),
      supabase.from('showcase_games').select('id, title, image_url, sort_order').eq('club_id', club.clubId).order('sort_order').order('created_at'),
    ]);
    if (zones.error) throw new Error(`Could not read zones of ${club.clubId}: ${zones.error.message}`);
    if (offers.error) throw new Error(`Could not read offers of ${club.clubId}: ${offers.error.message}`);
    if (games.error) throw new Error(`Could not read games of ${club.clubId}: ${games.error.message}`);

    const priceClub: YandexPriceClub = {
      clubName: club.clubName,
      logoUrl: club.logoUrl,
      zones: (zones.data ?? []) as ShowcasePcZone[],
      offers: (offers.data ?? []) as ShowcaseOffer[],
      games: (games.data ?? []) as Array<Pick<ShowcaseGame, 'id' | 'title' | 'image_url' | 'sort_order'>>,
    };
    // The cards are served from the public page, so an unpublished one keeps the photos.
    const cardsServed = !args.photoPictures && club.published && Boolean(club.slug);
    const { items, skipped } = buildYandexPriceItems(priceClub, {
      cardPictures: cardsServed ? { baseUrl: args.cardBaseUrl, slug: club.slug!, isCardImage } : null,
    });
    const ymlPath = outputPath(`${club.orgId}.yml`);
    writeFileSync(ymlPath, buildYandexYml(items, { clubName: club.clubName }));

    const snapshotPath = outputPath(`current-${club.orgId}.json`);
    const snapshot = readJson(snapshotPath);
    const diff = snapshot === null ? null : diffPriceList(parsePriceSnapshot(snapshot), items);
    writeJson(outputPath(`plan-${club.orgId}.json`), {
      clubId: club.clubId,
      orgId: club.orgId,
      clubName: club.clubName,
      generatedAt: new Date().toISOString(),
      items,
      skipped,
      diff,
      diffCounts: diff ? priceDiffCounts(diff, items.length) : null,
      // The agent sets this to true once the YML is uploaded; only then does the report mention the price list.
      uploaded: false,
    });

    console.log(`\n${club.clubName} (${club.address ?? 'no address'}), Yandex org ${club.orgId}`);
    console.log(`  ${items.length} items -> ${ymlPath}`);
    const cardsDirectory = await writePriceCards(club, priceClub, items, isCardImage);
    console.log(`  price cards -> ${cardsDirectory}`);
    if (args.photoPictures) console.log('  pictures: zone photos and logo (--photo-pictures)');
    else if (!cardsServed) console.warn('  pictures: zone photos and logo, because the club page is not published (the card route serves only published pages)');
    else console.log(`  pictures: price cards at ${args.cardBaseUrl}/${club.slug}/<id>.png`);
    const covers = gameCoverReport(priceClub.games ?? [], isCardImage);
    console.log(`  games with a cover: ${covers.withCover.length ? covers.withCover.join(', ') : 'none'}`);
    if (covers.missing.length) console.log(`  popular games without a cover (add them with a cover to vary the cards): ${covers.missing.join(', ')}`);
    for (const item of skipped) {
      console.log(`  skipped ${item.kind} "${item.name}": ${item.reason === 'no_price' ? 'no price' : 'an active 1-hour package already sells this hour'}`);
    }
    if (diff) {
      console.log(`  Change against ${snapshotPath}:`);
      for (const line of formatPriceDiff(diff)) console.log(`    ${line}`);
    } else {
      console.log(`  No ${snapshotPath}: save the card's current list there to see what the upload changes.`);
    }
  }
}

async function replies(clubs: SyncClub[]) {
  const writer = createReviewReplyWriter();
  if (!writer) console.warn('No AI model is configured: only replies already in the files are kept.');
  for (const club of clubs) {
    const reviewsPath = outputPath(`reviews-${club.orgId}.json`);
    const reviewsJson = readJson(reviewsPath);
    if (reviewsJson === null) {
      console.log(`\n${club.clubName}: no ${reviewsPath}, skipped`);
      continue;
    }
    const repliesPath = outputPath(`replies-${club.orgId}.json`);
    const previousJson = readJson(repliesPath);
    const file = await buildYandexReplies(
      parseYandexReviews(reviewsJson),
      previousJson === null ? null : parseYandexReplies(previousJson),
      club.clubName,
      writer,
    );
    const safe = { ...file, replies: file.replies.map((entry) => (entry.error ? { ...entry, error: safeMessage(entry.error) } : entry)) };
    writeJson(repliesPath, { clubId: club.clubId, orgId: club.orgId, generatedAt: new Date().toISOString(), ...safe });

    console.log(`\n${club.clubName}: ${safe.replies.length} unanswered -> ${repliesPath}`);
    for (const entry of safe.replies) {
      console.log(`  [${entry.rating ?? '-'}★] ${entry.author ?? 'anonymous'}, ${entry.date ?? 'no date'}: ${entry.text ?? '(no text)'}`);
      console.log(entry.reply ? `    -> ${entry.reply}${entry.posted ? ' (posted)' : ''}` : `    !! no reply: ${entry.error ?? 'unknown'}`);
    }
  }
}

async function report(supabase: SupabaseClient, clubs: SyncClub[], args: YandexSyncArgs) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!args.dryRun && !botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set in .env.local');
  for (const club of clubs) {
    const repliesJson = readJson(outputPath(`replies-${club.orgId}.json`));
    const planJson = readJson(outputPath(`plan-${club.orgId}.json`));
    if (repliesJson === null && planJson === null) {
      console.log(`\n${club.clubName}: nothing ran for this club, skipped`);
      continue;
    }
    const startHour = await getClubBusinessDayStartHour(supabase, club.clubId);
    const businessDateOf = (instant: Date) => serverTodayIso(instant, startHour);
    const digestDate = businessDateOf(new Date());
    const digest = yandexReviewDigest(club, parseYandexReplies(repliesJson), digestDate);
    const caption = yandexDigestCaption(digest, uploadedPriceCounts(planJson));
    const png = await renderReviewDigestPng(digest, null, YANDEX_MAPS_DIGEST_SOURCE);
    const fileName = `yandex-reviews-${club.orgId}-${digestDate}.png`;
    writeFileSync(outputPath(fileName), png);
    console.log(`\n${club.clubName}: ${outputPath(fileName)}\n  ${caption}`);

    const sentPath = outputPath(`sent-${club.orgId}-${digestDate}.json`);
    const decision = yandexReportDecision({
      alreadySent: existsSync(sentPath),
      resend: args.resend,
      digestDate,
      generatedAt: [repliesJson, planJson].filter((file) => file !== null).map(generatedAtOf),
      businessDateOf,
    });
    if (decision === 'stale') {
      console.log(`  The plan or replies file was not made on business date ${digestDate}: run plan/replies again${args.dryRun ? '' : '. Not sent'}`);
      if (!args.dryRun) process.exitCode = 1;
      continue;
    }
    if (args.dryRun) continue;
    if (decision === 'already_sent') {
      console.log(`  Already sent for ${digestDate} (${sentPath}): not sent again; pass --resend to send anyway`);
      continue;
    }

    const chatId = targetChatId(club.clubId)?.trim();
    if (!chatId) {
      console.log('  No Telegram group is configured for this club: not sent');
      continue;
    }
    try {
      const sent = await sendTelegramPhoto({ botToken: botToken!, chatId, imagePng: png, imageFileName: fileName, caption, maxAttempts: 3, timeoutMs: 10_000 });
      const messageId = sent.result.message_id ?? null;
      writeJson(sentPath, { clubId: club.clubId, orgId: club.orgId, digestDate, messageId, sentAt: new Date().toISOString() });
      console.log(`  Sent to the club's Telegram group (message ${messageId ?? 'unknown'})`);
    } catch (error) {
      console.error(`  Telegram send failed: ${safeMessage(error)}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const parsed = parseYandexSyncArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  const { args } = parsed;
  loadLocalEnvironment();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const clubs = await loadClubs(supabase, args.clubId);
  if (args.command === 'plan') await plan(supabase, clubs, args);
  else if (args.command === 'replies') await replies(clubs);
  else await report(supabase, clubs, args);
}

main().catch((error) => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
