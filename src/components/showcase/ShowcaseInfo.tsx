import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  BadgePercent, Cigarette, Clock, CreditCard, Crown, CupSoda, Gamepad2, MapPin, Milestone, Moon, Navigation, Phone, Send,
  Snowflake, SquareParking, Star, Trophy, Utensils, Wifi, type LucideIcon,
} from 'lucide-react';
import { formatCurrency, formatPhone, intlLocaleFor } from '@/lib/formatters';
import {
  buildPriceMatrix, clubLabel, mapLinks, telHref, yandexMapWidgetUrl,
  zonePriceCard, type PriceCell, type PublicShowcase, type ShowcaseAmenity,
} from '@/lib/showcase';
import { BookingButton, type BookingClub } from './BookingButton';

/** Heading level of a card title, by how deep the card sits on its page. */
export type InfoHeading = 'h3' | 'h4';

/**
 * The clubs a visitor can send a booking request to (those with a Telegram
 * link), with the zones they can ask for. `brandName` names a branch in the
 * request as "Brand — Branch".
 */
export function bookingClubs(clubs: PublicShowcase[], brandName?: string): BookingClub[] {
  return clubs.flatMap((club) => {
    if (!club.telegram_url) return [];
    const priced = buildPriceMatrix(club.offers, club.zones).rows.map((row) => row.zone);
    return [{
      slug: club.slug,
      label: clubLabel(club),
      messageName: brandName && club.branch_name ? `${brandName} — ${club.branch_name}` : club.club_name,
      telegramUrl: club.telegram_url,
      zones: priced.length > 0 ? priced : club.zones.map((zone) => zone.name),
    }];
  });
}

/** The Google Maps rating as a small badge that opens the club's place. */
export async function RatingBadge({ club, className }: { club: PublicShowcase; className?: string }) {
  if (!club.rating) return null;
  const t = await getTranslations('publicShowcase');
  const locale = await getLocale();
  const value = new Intl.NumberFormat(intlLocaleFor(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(club.rating.value);
  const content = (
    <>
      <Star size={14} className="shrink-0 fill-amber-300 text-amber-300" aria-hidden="true" />
      <span className="sc-num font-bold text-white">{value}</span>
      <span className="text-white/75">{t('ratingReviews', { count: club.rating.count })}</span>
    </>
  );
  const shape = `inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/15 ${className ?? ''}`;
  const href = mapLinks(club)?.google;
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t('ratingLabel', { rating: value, count: club.rating.count })} className={`${shape} transition-colors hover:bg-black/75`}>{content}</a>
    : <span className={shape}>{content}</span>;
}

/**
 * A club's whole price list as one table: a row per zone, a column per
 * package, the saving against single hours under each package price. Phones
 * get the same figures as one small table per zone, day and night rates side
 * by side. Combos follow as cards.
 */
export async function PriceTable({ club, heading: Heading = 'h4' }: { club: PublicShowcase; heading?: InfoHeading }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const { columns, rows, specials } = buildPriceMatrix(club.offers, club.zones);
  if (rows.length === 0 && specials.length === 0) return null;
  const currency = tc('currency');
  const columnLabel = (label: string | null) => label ?? t('offersHourly');
  const cell = (entry: PriceCell, index: number) => (
    <span key={index} className="block">
      <span className="sc-num whitespace-nowrap text-base font-bold text-white">
        {formatCurrency(entry.price)} <span className="text-xs font-medium text-white/60">{currency}</span>
      </span>
      {entry.time_window && <span className="sc-num block whitespace-nowrap text-xs text-white/65">{entry.time_window}</span>}
      {entry.saving !== null && (
        <span className="sc-num block whitespace-nowrap text-xs font-semibold text-lime-300">{t('priceSaving', { amount: formatCurrency(entry.saving) })}</span>
      )}
    </span>
  );
  const cells = (entries: PriceCell[] | undefined) => (entries?.length
    ? <span className="inline-flex flex-col gap-2">{entries.map(cell)}</span>
    : <span className="text-white/40" aria-label={t('priceNone')}>—</span>);

  return (
    <div className="space-y-6">
      {rows.length > 0 && (
        <>
          <div className="sc-card hidden overflow-x-auto rounded-3xl sm:block">
            <table className="sc-price-table w-full border-collapse text-sm">
              <caption className="sr-only">{t('pricesCaption', { club: club.club_name })}</caption>
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wider text-white/65">
                  <th scope="col">{t('priceZone')}</th>
                  {columns.map((column) => <th key={column.key} scope="col">{columnLabel(column.label)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.zone}>
                    <th scope="row" className="sc-display text-base font-bold text-white">{row.zone}</th>
                    {columns.map((column) => <td key={column.key}>{cells(row.cells[column.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 sm:hidden">
            {rows.map((row) => {
              const card = zonePriceCard(row, columns);
              const span = Math.max(card.windows.length, 1);
              return (
                <li key={row.zone} className="sc-card rounded-2xl px-4 pb-1.5 pt-4">
                  <table className="sc-zone-prices w-full border-collapse">
                    <caption className="sc-display pb-1 text-left text-lg font-bold text-white">{row.zone}</caption>
                    {card.windows.length > 0 && (
                      <thead>
                        <tr>
                          <td />
                          {card.windows.map((time) => (
                            <th key={time} scope="col" className="sc-num whitespace-nowrap text-xs font-semibold text-violet-200">{time}</th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {card.lines.map((line) => (
                        <tr key={line.key}>
                          <th scope="row" className="text-sm font-medium text-white/75">{columnLabel(line.label)}</th>
                          {line.slots
                            ? line.slots.map((slot, index) => (
                              <td key={card.windows[index]}>
                                {slot ? cell({ ...slot, time_window: null }, index) : <span className="text-white/40" aria-label={t('priceNone')}>—</span>}
                              </td>
                            ))
                            : (
                              <td colSpan={span}>
                                <span className="inline-flex gap-4">{line.cells.map(cell)}</span>
                              </td>
                            )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {specials.length > 0 && (
        <ul className={`grid gap-4 ${specials.length > 1 ? 'md:grid-cols-2' : ''}`}>
          {specials.map((offer) => (
            <li key={offer.id} className="sc-offer rounded-3xl p-[1px]">
              <article className="flex h-full flex-col gap-3 rounded-[calc(1.5rem-1px)] bg-[#0b0b16] p-5 sm:flex-row sm:items-center sm:gap-5">
                <span className="inline-flex h-12 min-w-12 shrink-0 items-center justify-center self-start rounded-2xl bg-violet-500/20 px-3 text-xs font-bold uppercase tracking-wider text-violet-200 ring-1 ring-violet-300/30 sm:self-center">
                  {offer.badge ?? <BadgePercent size={20} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <Heading className="text-base font-semibold text-white">{offer.title}</Heading>
                  {offer.description && <p className="mt-1 text-sm leading-6 text-white/70">{offer.description}</p>}
                  {offer.time_window && <p className="sc-num mt-1 flex items-center gap-1.5 text-xs text-white/65"><Clock size={12} aria-hidden="true" /> {offer.time_window}</p>}
                </div>
                {offer.price !== null && (
                  <p className="sc-display sc-num shrink-0 whitespace-nowrap text-xl font-bold text-lime-300">
                    {formatCurrency(offer.price)} <span className="text-xs font-semibold text-white/60">{currency}</span>
                  </p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether the club has anything to show in a price list. */
export function hasPrices(club: PublicShowcase): boolean {
  const matrix = buildPriceMatrix(club.offers, club.zones);
  return matrix.rows.length > 0 || matrix.specials.length > 0;
}

const AMENITY_ICONS: Record<ShowcaseAmenity, LucideIcon> = {
  open_24_7: Clock,
  playstation: Gamepad2,
  vip_zone: Crown,
  night_packages: Moon,
  food: Utensils,
  drinks: CupSoda,
  card_payment: CreditCard,
  wifi: Wifi,
  air_conditioning: Snowflake,
  parking: SquareParking,
  tournaments: Trophy,
  smoking_area: Cigarette,
};

/** What the club offers besides computers, as a grid of labelled icons. */
export async function AmenityList({ amenities }: { amenities: ShowcaseAmenity[] }) {
  if (amenities.length === 0) return null;
  const t = await getTranslations('publicShowcase.amenities');
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {amenities.map((amenity) => {
        const Icon = AMENITY_ICONS[amenity];
        return (
          <li key={amenity} className="sc-card flex items-center gap-3 rounded-2xl p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200 ring-1 ring-violet-300/20">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0 text-sm font-medium leading-5 text-white/90">{t(amenity)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-violet-200 ring-1 ring-white/10">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-semibold uppercase tracking-wider text-white/65">{label}</dt>
        <dd className="break-words text-base font-medium text-white">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Where the club is and how to reach it: address, landmark, hours and phone
 * beside the club's own place on the map, with both map apps one tap away.
 */
export async function FindUs({ club, booking }: { club: PublicShowcase; booking: BookingClub[] }) {
  const t = await getTranslations('publicShowcase');
  const maps = mapLinks(club);
  const widget = yandexMapWidgetUrl(club.yandex_maps_url);
  const phone = telHref(club.phone);
  if (!club.address && !club.phone && !club.opening_hours) return null;
  const secondary = 'sc-chip inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold';

  return (
    <div className={`sc-card grid overflow-hidden rounded-3xl ${widget ? 'lg:grid-cols-[1fr_1.15fr]' : ''}`}>
      <div className="flex flex-col gap-6 p-5 sm:p-7">
        <dl className="space-y-4">
          {club.address && <InfoRow icon={<MapPin size={17} aria-hidden="true" />} label={t('address')}>{club.address}</InfoRow>}
          {club.landmark && <InfoRow icon={<Milestone size={17} aria-hidden="true" />} label={t('landmark')}>{club.landmark}</InfoRow>}
          {club.opening_hours && <InfoRow icon={<Clock size={17} aria-hidden="true" />} label={t('hours')}>{club.opening_hours}</InfoRow>}
          {club.phone && (
            <InfoRow icon={<Phone size={17} aria-hidden="true" />} label={t('phone')}>
              {phone ? <a href={phone} className="sc-num underline decoration-white/25 underline-offset-4 hover:decoration-white">{formatPhone(club.phone)}</a> : club.phone}
            </InfoRow>
          )}
        </dl>
        <RatingBadge club={club} className="self-start" />
        <div className="mt-auto flex flex-wrap gap-2">
          {booking.length > 0 && (
            <BookingButton clubs={booking} initialSlug={club.slug} className="sc-cta inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white">
              <Send size={16} aria-hidden="true" /> {t('bookTelegram')}
            </BookingButton>
          )}
          {maps && (
            <>
              <a href={maps.yandex} target="_blank" rel="noopener noreferrer" className={secondary}><Navigation size={16} aria-hidden="true" /> {t('mapYandex')}</a>
              <a href={maps.google} target="_blank" rel="noopener noreferrer" className={secondary}><Navigation size={16} aria-hidden="true" /> {t('mapGoogle')}</a>
            </>
          )}
          {phone && <a href={phone} className={secondary}><Phone size={16} aria-hidden="true" /> {t('call')}</a>}
        </div>
      </div>
      {widget && (
        <div className="relative min-h-[18rem] border-t border-white/10 lg:min-h-[24rem] lg:border-l lg:border-t-0">
          <iframe
            src={widget}
            title={t('mapTitle', { club: club.club_name })}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      )}
    </div>
  );
}
