# A forced report resend carries the Google Maps bot photo

## Goal

The daily report album carries the "AI bot" Google Maps review image
(`google_review_digests`, migration 173). Today only a digest with
`awaiting_report = true` is attached (`loadAwaitingReviewDigestPhoto` in
`src/lib/googleBusiness/reviewDigestPhoto.ts`, called from
`src/app/api/cron/daily-finance-report/route.ts` ~557). The scheduled send marks
it sent, so a forced resend (`force=1`) of the same business date goes out
without the photo and without the "🤖 ИИ-бот…" caption line.

A forced resend must include the same digest the scheduled report for that
business date carried.

## Design

- A digest's `digest_date` is the send day = the report's business date + 1
  (the morning review run writes it before the 08:00 report).
- Scheduled (non-forced) sends: unchanged — awaiting digest only.
- Forced sends: first the awaiting digest as today (if the scheduled send has
  not happened yet). If none is awaiting, load the club's digest with
  `digest_date = businessDate + 1` (scoped by `club_id`), whatever its
  `awaiting_report`/`sent_at`. Add a loader beside
  `loadAwaitingReviewDigestPhoto` (e.g. `loadReviewDigestPhotoForDate`)
  reusing the same row mapping, `previous` lookup and rendering; no
  duplicated formatter.
- Recording after a forced resend of an already-sent digest: update its
  `telegram_message_id` to the new album's message id and `sent_at`; never set
  `awaiting_report` back to true and never overwrite a successful send with an
  error from the resend (on error, log only). Keep `completeReviewDigest`'s
  behaviour for the awaiting path.
- Dry runs: do not attach or record anything new (keep current behaviour).
- Best-effort as today: any failure loading the digest never blocks the report.

## Tests

Cron route tests: forced resend with no awaiting digest attaches the dated
digest (album gets the extra photo, caption gets the bot line) and records the
new message id; forced resend with an awaiting digest behaves as today;
scheduled send ignores non-awaiting digests; a failed dated-digest load still
sends the report. Unit test for the new loader (club scoping, date = business
date + 1).

## Slices

1. All of the above. No migration.
