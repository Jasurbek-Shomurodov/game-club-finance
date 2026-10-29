# Google Maps (Business Profile) posting

**Public page → Google Maps** (`/showcase/google`) connects a club to its
Google Business Profile listing. Once connected, the club can publish updates,
events, offers and photos from the admin app, and owners can edit the listing's
description, phone, website and opening hours. Google Maps has no "stories" for
businesses; posts and photos are the closest equivalent.

## How it works

```text
owner clicks Connect -> /api/google-business/connect (owner check, state cookie)
  -> Google consent (scope business.manage, offline)
  -> /api/google-business/callback (state + owner re-check, code exchange)
  -> google_business_connections (refresh token AES-GCM encrypted, service role only)
post / photo -> /api/google-business/posts|photos (showcase feature check)
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
- Photos are uploaded first to the public `showcase` bucket (`<club_id>/google-*`).
  Google then downloads them from that URL.
- Disconnecting revokes the token at Google (best effort) and deletes the row.
  Posts already on Google stay there.

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
6. Apply migration `112_google_business_profile.sql`.
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
