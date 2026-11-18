# Google Maps (Business Profile) posting

**Public page → Google Maps** (`/showcase/google`) connects a club to its
Google Business Profile listing. Once connected, the club can publish updates,
events, offers, photos and videos from the admin app, and owners can edit the listing's
description, phone, website and opening hours. Google Maps has no "stories" for
businesses; posts and photos are the closest equivalent.

## How it works

```text
owner clicks Connect -> /api/google-business/connect (owner check, state cookie)
  -> Google consent (scope business.manage, offline)
  -> /api/google-business/callback (state + owner re-check, code exchange)
  -> google_business_connections (refresh token AES-GCM encrypted, service role only)
post / photo / video -> /api/google-business/posts|photos|videos (showcase feature check)
  -> refresh access token -> Business Profile API v4 localPosts / media
```

- Connecting, choosing the listing and disconnecting are owner-only.
  Publishing posts and photos needs the `showcase` feature, which owners have
  and can grant to others on Team.
- Listing info (`/api/google-business/listing`) uses the Business Information
  API v1 `locations.patch` with an update mask of only the changed fields. The
  name and address are not editable here: changing them makes Google verify the
  listing again. Saving the phone keeps the listing's additional numbers. Hours
  allow one range per day; a close earlier than the open is after midnight.
  Reading needs the `showcase` feature; saving is owner-only.
- Photos and videos are uploaded first to the public `showcase` bucket
  (`<club_id>/google-*`). Google then downloads them from that URL.
- Videos go in as v4 media with `mediaFormat: VIDEO` (category `ADDITIONAL`).
  The page takes MP4 or MOV up to 30 seconds, 50 MB and 720p, the bucket's
  limit since migration `159_showcase_bucket_videos.sql` (Google allows 75 MB).
  When the browser cannot read a video's length or resolution, Google checks
  them itself. Google reviews each video before it appears on Maps.
- Disconnecting revokes the token at Google (best effort) and deletes the row.
  Posts already on Google stay there.
- Reconnecting with the same account keeps the chosen listing if Google cannot
  list locations at that moment, and leaves the old token alone: revoking it
  would end the new one too. Connecting a different account revokes the old
  account's token.

## Daily review replies

Supabase Cron (migration `152_google_review_auto_replies.sql`, job
`game-club-google-review-replies`) calls `/api/cron/google-review-replies`
every day at `03:00 UTC` (08:00 Tashkent), the same time as the daily finance
report since migration `161_google_review_replies_with_reports.sql`, with the
same Vault secret and `CRON_SECRET` as the Telegram report.

```text
cron -> /api/cron/google-review-replies (CRON_SECRET)
  -> every connection with a chosen listing and review_auto_reply = true
  -> v4 reviews.list (up to 3 pages of 50) -> reviews with no reply
  -> AI writes a reply in the review's language (src/lib/googleBusiness/reviews.ts prompt)
  -> v4 reviews.updateReply -> google_review_replies (one row per review)
  -> per club with a Telegram group: google_review_digests row (claims the day)
  -> "AI bot" image (src/lib/googleBusiness/reviewDigestImage.ts) -> sendPhoto
```

- After replying, each club whose `TELEGRAM_*_CLUB_ID` maps to a
  `TELEGRAM_*_CHAT_ID` group gets one Russian image a day: rating and review
  count with the change since the previous image, how many replies were sent
  and still wait, and each review with the reply posted. Text in scripts the
  bundled Noto Sans cannot draw (Chinese, Arabic) is described instead.
- The day's `google_review_digests` row (migration
  `160_google_review_digests.sql`) is inserted before sending, so a repeated
  or timed-out run never posts the image twice; a failed send is kept in
  `send_error` and not retried. Without `TELEGRAM_BOT_TOKEN` no image is sent.
  The JSON's `digest` per club is `sent`, `held` (already sent today),
  `skipped` (no group) or `failed`.

- Replies are written by the assistant's model chain (`ASSISTANT_PROVIDER`,
  `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`, optional `ASSISTANT_MODEL`). Without
  a model key the run answers 503 and posts nothing. Reviews are public, so the
  free Gemini tier is allowed here.
- Each run posts at most 10 replies per listing, oldest first, and stops
  starting new ones 20 seconds before the 60-second limit, leaving time for
  the Telegram images; a backlog clears over the following days.
- A quota, expired-access or permission error stops that club's run and the
  next club continues. A review whose reply could not be written or posted is
  tried again the next day.
- Auto replies are on by default. Owners turn them off under **Public page →
  Google Maps → Review replies**, which also lists the last 20 replies.
- To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET"
  https://admin.pixelgaming.uz/api/cron/google-review-replies`. The JSON lists
  per club how many reviews were replied, failed and are still waiting.

## One-time setup

1. **Business Profile API access.** In Google Cloud, create a project. Then
   submit Google's *Business Profile API access request* form for that project.
   Until Google approves it, every Business Profile call fails with a quota
   error, and the page says so ("Google has not approved Business Profile API
   access…"). The listing must be verified.
2. **Enable the APIs** in that project: *My Business Account Management API*,
   *My Business Business Information API* and *Google My Business API* (v4,
   for posts and media).
3. **OAuth consent screen.** Use the External type, add the scope
   `https://www.googleapis.com/auth/business.manage` and publish the app. A
   consent screen left in Testing issues refresh tokens that expire after 7 days.
4. **OAuth client.** Choose the *Web application* type, with this authorized
   redirect URI:
   `https://admin.pixelgaming.uz/api/google-business/callback`
   (add `http://localhost:3000/api/google-business/callback` for local work).
5. **Server environment** (Vercel, server-only, never `NEXT_PUBLIC_`):
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`: 32 or more random characters, for example
     `openssl rand -base64 48`. Changing it makes stored tokens unreadable, and
     every club then has to connect again.
6. Apply migrations `112_google_business_profile.sql` and
   `159_showcase_bucket_videos.sql` (video uploads).
7. An owner opens **Public page → Google Maps → Connect Google** for each club.
   They sign in with the account that manages the listing. If the account
   manages several listings, they pick one. Picking needs API approval, because
   listing locations is a Business Profile call.

## Troubleshooting

| Page message | Cause | Fix |
|---|---|---|
| Not set up on the server | One of the three variables is missing, or the key is shorter than 32 characters | Set them and redeploy. |
| Not approved / limit used up | API access is pending (quota 0), or the daily quota is used up | Wait for Google's approval email, or try again tomorrow. |
| Access has expired | The refresh token was revoked, the password was changed, the app is in Testing mode, or the encryption key changed | An owner connects again. |
| Google refused | The account does not manage the listing, or an API is not enabled | Connect the right account, or enable the APIs. |
| Did not grant offline access | Google skipped the refresh token | Remove the app at myaccount.google.com/permissions and connect again. |

Server logs use the `[google-business]` prefix and never include tokens.
