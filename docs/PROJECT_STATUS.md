# Project status — 2026-09-29

## What exists

Eleven11 is a posting prototype with a read-only daily feed and private wish
journal. The app routes are the clock (`app/index.tsx`), composer
(`app/compose.tsx`), feed (`app/feed.tsx`), and journal (`app/my-wishes.tsx`).
Items below distinguish the implemented local v0.4 scope from remaining product work.

Implemented locally:

- Animated clock and countdown for 90-second windows at 11:11 AM and PM.
- Text composer, photo selection, authenticated Storage upload, and submit feedback.
- Anonymous Firebase authentication with shared sign-in requests.
- Server-side window and payload validation; one post per account/local day using
  a Firestore transaction and daily claim document.
- Read-only daily feed with loading, empty, error, pull-to-refresh, and
  pagination states. It shows active captions, photos, and viewer-local posting
  times, newest first.
- A viewer-local feed date: the range from local midnight to the next local
  midnight of server `createdAt`. This handles 23- and 25-hour daylight-saving
  days, while author-local `dayKey` remains the one-post-per-local-day key.
- Firestore read policy and composite index configuration for active daily-feed
  queries. Non-active documents are denied to clients and excluded from the UI.
- Expo SDK 57 / React Native 0.86 / Firebase JS 12 dependencies for Expo Go 57.
- Regression tests for time boundaries, timezone rollover, invalid media and
  payloads, and duplicate submissions with a mock transaction adapter.
- npm lockfiles and GitHub Actions checks for the app and backend.
- Compose visibility choices: private by default, or anonymously shared.
  The backend validates the choice and applies the same daily posting limit.
- Personal journal with owner-only history, labels, images, refresh, and pagination.
- Per-identity saved drafts, with durable local copies of selected photos where
  `expo-file-system` provides a document directory.
- Private-post Firestore and Storage protection: private documents are owner-only;
  the backend verifies the uploaded object owner/path and clears private download
  tokens before storing the post. The feed is callable-backed and omits owner UIDs.

## Unfinished features and integration work

| Priority | Area | Evidence / gap | Completion target |
| --- | --- | --- | --- |
| First | Firebase/device integration | v0.4 was exercised only in isolated emulators; no live deployment or device posting test was performed. | Deploy reviewed functions/rules/indexes, then verify private/shared text/photo submission on iPhone. |
| First | Feed moderation and media revocation | The feed hides non-active Firestore documents, but an already shared public Storage download URL remains usable. | Use revocable media delivery and moderation actions before claiming hidden media is inaccessible. |
| Before public launch | Reactions | Only zero-valued `reacts.sparkle` and `reacts.crystal` fields are created. No UI or callable updates them. | Reaction controls, authenticated server mutation, duplicate/toggle policy and tests. |
| Before public launch | Reports and moderation | Only a report counter and a permissive signed-in `/reports` create rule exist. No report UI, validated payload, review flow or moderation actions. The feed excludes non-active Firestore documents but cannot revoke public image URLs already shared. | Define/report reasons, validate ownership/target data, rate-limit reports, moderation actions, and revocable media delivery. |
| Before public launch | Posting identity/timezone policy | Anonymous users can reset their identity; the timezone comes from the caller. Daily claims protect one UID/date, not one person or a rolling 24 hours. | Define stable account and timezone-change rules if a stronger daily limit is required. |
| Before public launch | Media lifecycle and ownership | The backend now verifies the uploader UID, path, image type, and size before accepting an object reference; failed or expired submissions can still leave an orphan if cleanup cannot complete. | Add scheduled orphan cleanup and define post/media deletion. |
| Next | Draft/retry experience | Drafts restore caption, visibility, and durable local photos; no upload progress UI exists. | Add upload progress and device-level recovery testing. |
| Next | Responsive layout/accessibility | Fixed offsets/heights and initial screen dimensions; image buttons have no explicit accessibility labels. No native visual or assistive-technology testing yet. | Check safe areas, small screens, keyboard, screen reader, large text and reduced motion on devices. |
| Next | Feed detail and historical views | The feed is intentionally limited to the viewer's current local day. There is no post detail route, author history, or historical archive. | Make product decisions before adding history or profiles. |
| Next | Release packaging | No EAS build profiles, app icons, native bundle identifiers, or release/deployment workflow. | Configure these when a standalone install/release is wanted; Expo Go preview does not require them. |

## Optional expansion, not implemented or yet specified

Profiles, permanent sign-in/account recovery, notifications and 11:11 reminders,
friends/following, sharing and post editing are absent. Journal access is tied to
the current Firebase identity, and account recovery is not implemented.

## Checks completed on 2026-09-28

- Mobile TypeScript check: passed.
- Expo dependency compatibility check: passed against the installed SDK map
  (offline; not a fresh online Expo Doctor result).
- Production bundle exports: iOS, Android and web all passed after dependency updates.
- Functions TypeScript build and ESLint: passed.
- Regression tests: 7 passed, 0 failed.
- GitHub workflow/issue-template YAML and staged whitespace checks: passed.

## Verification limits

Type checking, builds and unit tests do not prove live Firebase or phone behavior.
The transaction test uses an in-memory adapter, not the Firestore emulator. Security
rules have not been exercised against emulators. Nothing in this review deployed
Firebase resources or submitted real posts. CI is configured to repeat local
checks, and its result should be checked after pushing.

## Dependency audit

Compatible security updates were applied on 2026-09-28. The resulting npm audit
reports contain **13 moderate findings for mobile** and **8 moderate findings for
functions**, with no high or critical findings remaining. Counts include parent
packages affected by transitive dependencies; they are not counts of distinct
exploits in the app.

Remaining advisories concern `decode-uri-component` through Expo Router and
`uuid` through Expo's Xcode tooling and Firebase Admin/Google Cloud dependencies.
The automated suggestions include downgrading Expo/Router to incompatible older
majors or upgrading Firebase Admin across majors, so `--force` was not applied.
Track upstream-compatible fixes and assess runtime exposure before public release.

- https://github.com/advisories/GHSA-vcc3-ghjq-m6fr
- https://github.com/advisories/GHSA-w5hq-g745-h8pq

## v0.3 verification — daily feed

- Local Firebase Emulator Suite test passed with callable-created posts: active
  posts were queried newest-first over two pages, a photo post appeared, a
  non-active post was excluded, and a direct client read of that hidden post was
  rejected by Firestore Rules. The virtual server time was set to 2026-09-30
  01:30 UTC (Toronto evening on 2026-09-29), so the feed query used Toronto's
  local, rather than UTC, day boundaries.
- Feed-range regression tests cover that Toronto/UTC crossover and the
  2026-03-08 Toronto spring-forward day, whose local range is 23 hours.
- Mobile TypeScript check, Functions build/lint, and all nine
  regression tests passed after the feed changes. The Expo export completed for
  iOS, Android, and web.
- A physical-device feed run still needs to be repeated after an approved
  Firestore rules/index deployment. No Firebase deployment was performed for
  v0.3.

## Suggested next milestone

Before reactions or social features, settle moderation and media revocation:
hiding a Firestore post cannot invalidate a public image URL that was already
shared. Then revisit stable identity/timezone policy and media ownership.

## v0.4 verification — wish journal

- Isolated Firebase Emulator Suite run passed using two anonymous identities:
  owner private document/image access worked; the second identity was rejected
  by Firestore, Storage, and the private-image callable; shared posts appeared
  in the UID-free anonymous feed; private posts did not.
- The same run confirmed history includes a seeded older owner wish, identity
  isolation, daily-feed pagination, and one-per-local-day rejection across a
  private post followed by a shared attempt. The test also verified the upload
  path and owner metadata, then performed owner cleanup of a pending object.
- Mobile typecheck, Functions build/lint, ten regression tests, and Expo export
  for iOS, Android, and web passed. No live Firebase data, rules, indexes, or
  functions were deployed.
- Deployment requirement: deploy the v0.4 Functions, Firestore rules and the
  `uid, createdAt` history index, and Storage rules together. Existing posts
  without `visibility` retain shared compatibility until a reviewed migration.
