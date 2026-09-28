# Project status — 2026-09-28

## What exists

Eleven11 is a **posting prototype**, not yet a complete social collage app.
The only app routes are the clock (`app/index.tsx`) and composer (`app/compose.tsx`),
plus their navigation layout. No additional feature specification or GitHub
issues/PRs were present at review time. Items below distinguish missing parts of
the original social-collage idea from optional product expansion.

Implemented locally:

- Animated clock and countdown for 90-second windows at 11:11 AM and PM.
- Text composer, photo selection, authenticated Storage upload, and submit feedback.
- Anonymous Firebase authentication with shared sign-in requests.
- Server-side window and payload validation; one post per account/local day using
  a Firestore transaction and daily claim document.
- Expo SDK 57 / React Native 0.86 / Firebase JS 12 dependencies for Expo Go 57.
- Regression tests for time boundaries, timezone rollover, invalid media and
  payloads, and duplicate submissions with a mock transaction adapter.
- npm lockfiles and GitHub Actions checks for the app and backend.

## Unfinished features and integration work

| Priority | Area | Evidence / gap | Completion target |
| --- | --- | --- | --- |
| First | Firebase/device integration | Client uses a real Firebase project; no live deployment or device posting test was performed in this review. | Verify anonymous auth, actual bucket, deployed functions/rules, text/photo submission and duplicate rejection on iPhone. |
| First | Feed / daily collage | No post-reading code or feed/detail route. Successful submission returns to the clock. | Display real posts with images, loading/empty/error states and pagination; decide when reading is unlocked. |
| First | Clock synchronization | `getServerTime` exists in `functions/src/index.ts` but the client never calls it. Both screens gate themselves using the phone clock before asking the server. | Calculate server offset, refresh after resume, and reconcile server permission with the countdown. |
| Before public launch | Reactions | Only zero-valued `reacts.sparkle` and `reacts.crystal` fields are created. No UI or callable updates them. | Reaction controls, authenticated server mutation, duplicate/toggle policy and tests. |
| Before public launch | Reports and moderation | Only a report counter and a permissive signed-in `/reports` create rule exist. No report UI, validated payload, review flow or moderation actions. All posts remain publicly readable regardless of `status`. | Define/report reasons, validate ownership/target data, rate-limit reports, and enforce visibility for hidden posts and media. |
| Before public launch | Posting identity/timezone policy | Anonymous users can reset their identity; the timezone comes from the caller. Daily claims protect one UID/date, not one person or a rolling 24 hours. | Define stable account and timezone-change rules if a stronger daily limit is required. |
| Before public launch | Media lifecycle and ownership | Upload precedes submission; a failed/expired submission can leave an orphan. Backend accepts any HTTPS image URL without checking the uploaded object's owner. | Associate uploads with the submitting user/post, clean up abandoned objects, and define post/media deletion. |
| Next | Draft/retry experience | Caption and image exist only in component state. Image-picker exceptions have no visible recovery, and no draft restoration or upload progress exists. | Preserve drafts, show recoverable failures and upload progress, and prevent accidental loss on navigation. |
| Next | Responsive layout/accessibility | Fixed offsets/heights and initial screen dimensions; image buttons have no explicit accessibility labels. No native visual or assistive-technology testing yet. | Check safe areas, small screens, keyboard, screen reader, large text and reduced motion on devices. |
| Next | Emulator integration | `firebase.json` lists emulators, but the client never connects to them; Auth and Storage emulator setup is absent. | Explicit environment selection, phone-reachable host, complete emulator configuration and rules/integration tests. |
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

## Suggested next milestone

Verify the backend on the iPhone, then implement a read-only daily feed/collage
with a useful destination after posting. Settle clock synchronization and the
identity/timezone policy before adding reactions and moderation.

## v0.2 work in progress

- The clock and composer now sample `getServerTime`, estimate network latency,
  resync every minute and on app resume, and lock posting if the sample is stale.
- A photo is removed after a definitive posting rejection. An ambiguous network
  error preserves it because the server may have committed the post; server-side
  orphan cleanup remains to be implemented.
- Still required: deploy functions/rules, test text and photo posting plus duplicate
  rejection on an iPhone, and settle stable identity/timezone and media ownership.
