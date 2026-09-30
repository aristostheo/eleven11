# Project status — 2026-09-29

## What exists

Eleven11 is a posting prototype with a read-only daily feed. The app
routes are the clock (`app/index.tsx`), composer (`app/compose.tsx`), and feed
(`app/feed.tsx`). Items below distinguish the implemented v0.3 scope from
remaining product work.

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

## Unfinished features and integration work

| Priority | Area | Evidence / gap | Completion target |
| --- | --- | --- | --- |
| First | Firebase/device integration | Client uses a real Firebase project; no live deployment or device posting test was performed in this review. | Verify anonymous auth, actual bucket, deployed functions/rules, text/photo submission and duplicate rejection on iPhone. |
| First | Feed moderation and media revocation | The feed hides non-active Firestore documents, but an already shared public Storage download URL remains usable. | Use revocable media delivery and moderation actions before claiming hidden media is inaccessible. |
| Before public launch | Reactions | Only zero-valued `reacts.sparkle` and `reacts.crystal` fields are created. No UI or callable updates them. | Reaction controls, authenticated server mutation, duplicate/toggle policy and tests. |
| Before public launch | Reports and moderation | Only a report counter and a permissive signed-in `/reports` create rule exist. No report UI, validated payload, review flow or moderation actions. The feed excludes non-active Firestore documents but cannot revoke public image URLs already shared. | Define/report reasons, validate ownership/target data, rate-limit reports, moderation actions, and revocable media delivery. |
| Before public launch | Posting identity/timezone policy | Anonymous users can reset their identity; the timezone comes from the caller. Daily claims protect one UID/date, not one person or a rolling 24 hours. | Define stable account and timezone-change rules if a stronger daily limit is required. |
| Before public launch | Media lifecycle and ownership | Upload precedes submission; a failed/expired submission can leave an orphan. Backend accepts any HTTPS image URL without checking the uploaded object's owner. | Associate uploads with the submitting user/post, clean up abandoned objects, and define post/media deletion. |
| Next | Draft/retry experience | Caption and image exist only in component state. Image-picker exceptions have no visible recovery, and no draft restoration or upload progress exists. | Preserve drafts, show recoverable failures and upload progress, and prevent accidental loss on navigation. |
| Next | Responsive layout/accessibility | Fixed offsets/heights and initial screen dimensions; image buttons have no explicit accessibility labels. No native visual or assistive-technology testing yet. | Check safe areas, small screens, keyboard, screen reader, large text and reduced motion on devices. |
| Next | Feed detail and historical views | The feed is intentionally limited to the viewer's current local day. There is no post detail route, author history, or historical archive. | Make product decisions before adding history or profiles. |
| Next | Release packaging | No EAS build profiles, app icons, native bundle identifiers, or release/deployment workflow. | Configure these when a standalone install/release is wanted; Expo Go preview does not require them. |

## Optional expansion, not implemented or yet specified

Profiles, permanent sign-in/account recovery, personal post history, notifications
and 11:11 reminders, friends/following, sharing and post editing are absent. These
need product decisions; their absence does not indicate broken existing code.

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
