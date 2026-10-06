# Project status — 2026-10-03

## What exists

Eleven11 is a posting prototype with a read-only daily feed, private wish
journal, optional saved identities, reactions, local reminders, and a moderator review flow. The app routes are the clock
(`app/index.tsx`), composer (`app/compose.tsx`), feed (`app/feed.tsx`), journal
(`app/my-wishes.tsx`), account (`app/account.tsx`), and settings (`app/settings.tsx`). Items below distinguish
the implemented local v0.5 scope from remaining product work.

## v0.6 live cutover preparation — 2026-10-05

- Merged `master` was audited against `eleven11-aristos` without changing any
  live resource. Production still has three Gen 1 v0.2 callables; its rules,
  indexes, and Auth providers have not received the merged v0.3–v0.6 upgrade.
  The ordered maintenance plan is [V06_LIVE_CUTOVER.md](V06_LIVE_CUTOVER.md).
- A guarded production dry run found exactly two active legacy posts. It would
  label both shared, convert the one verified legacy image to a server-owned
  storage path, and clear the old token only during an approved apply. The dry
  run made no write and did not clear a token.
- Exact active Firestore/Storage Rules were archived locally under
  `ops/v06-live-cutover/rollback/`. The live Functions archive listed all three
  Gen 1 functions but received HTTP 403 for the source-upload object. The exact
  Functions ZIP is a known rollback limitation. The `63555ea` repository archive
  is behaviorally supported by live probes but remains an unproven fallback;
  the cutover's recovery plan is a coordinated forward fix.
- No Email/Password provider, moderator claim, rules/indexes, functions,
  migration, object metadata, or live image token changed in this preparation.

Implemented locally:

- Animated clock and countdown for 90-second windows at 11:11 AM and PM.
- Text composer, photo selection, authenticated Storage upload, and submit feedback.
- Anonymous Firebase authentication with shared sign-in requests.
- Optional email/password linking for the current anonymous identity, plus
  explicit existing-account sign-in, sign-out, and password-reset requests.
  Linking preserves the existing UID; account emails never appear in wishes or
  feed responses.
- Server-side window and payload validation; one post per account/local day using
  a Firestore transaction and daily claim document.
- Server-managed posting timezone initialized from a valid IANA device timezone.
  The server uses it for posting windows and `dayKey`; travel changes are
  deliberate, limited to once per seven days, and blocked for 24 hours after a
  post. Viewer-local feed ranges and device-local reminders are unchanged.
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
- One callable-backed ✨ reaction per Firebase identity on an active shared wish.
  Its aggregate is updated transactionally; reaction identities and direct client
  writes are blocked by Firestore Rules.
- Device-local 11:11 reminder settings for AM, PM, or both. Permission is asked
  only when enabling, disabled periods are cancelled, and timezone changes are
  reconciled when the app resumes.
- Shared feed cards can be reported once per Firebase identity with a validated
  reason and optional details. Reports are callable-only, rate-limited to five
  per identity per ten minutes, and never appear in feed responses.
- Moderator review is protected by a Firebase Auth custom `admin: true` claim
  in the server callables. A decision records the action, moderator UID, and
  server timestamp; it can dismiss a report or hide a shared wish.
- Hiding excludes a wish from callable feed results and all direct Firestore
  client reads. Shared images are served to the app only by an authenticated
  callable; hiding marks the object hidden, clears its download token, and
  blocks future Storage-rule reads. My wishes retains an owner-facing hidden
  journal entry without the shared image. If the Storage metadata update fails,
  the post stays hidden and its report is retained as a moderator-only image
  repair item rather than claiming revocation succeeded.

## Unfinished features and integration work

| Priority | Area | Evidence / gap | Completion target |
| --- | --- | --- | --- |
| First | Firebase/device integration | v0.5 was exercised only in isolated emulators; no live deployment or device posting test was performed. | Deploy reviewed functions/rules/indexes, then verify private/shared text/photo submission and reactions on iPhone. |
| First | Moderator administration | The app has no secure process to grant, audit, or revoke the Firebase `admin` custom claim. | Define a reviewed operational Admin SDK procedure before enabling production review access. |
| Before public launch | Reaction moderation | A single sparkle toggle is implemented. There are no rate limits, abuse controls, reaction notifications, or moderation workflow. | Define abuse limits and moderation policy before public launch. |
| Before public launch | Reminder device behavior | Unit checks cover scheduling, cancellation, denied permission, and timezone rescheduling. Native permission prompts, scheduled delivery, timezone changes, and notification taps have not been observed on a device. | Test iOS and Android devices after an app build. |
| Before public launch | Legacy image revocation | New app image delivery is revocable, but a URL already downloaded, copied, screenshotted, or issued by a legacy `media.url` cannot be recalled by hiding the Firestore post. | Inventory legacy URLs and run a reviewed Storage cleanup/migration; document that already copied media remains outside control. |
| Before public launch | Posting identity/timezone policy | Email/password recovery is optional and does not merge two existing identities. A person can still create a fresh anonymous identity, so daily claims protect one UID/date rather than one person or a rolling 24 hours. | Decide whether anonymous posting remains acceptable for launch and whether stronger account verification is needed. |
| Before public launch | Media lifecycle and ownership | The backend now verifies the uploader UID, path, image type, and size before accepting an object reference; failed or expired submissions can still leave an orphan if cleanup cannot complete. | Add scheduled orphan cleanup and define post/media deletion. |
| Next | Draft/retry experience | Drafts restore caption, visibility, and durable local photos; no upload progress UI exists. | Add upload progress and device-level recovery testing. |
| Next | Responsive layout/accessibility | Fixed offsets/heights and initial screen dimensions; image buttons have no explicit accessibility labels. No native visual or assistive-technology testing yet. | Check safe areas, small screens, keyboard, screen reader, large text and reduced motion on devices. |
| Next | Feed detail and historical views | The feed is intentionally limited to the viewer's current local day. There is no post detail route, author history, or historical archive. | Make product decisions before adding history or profiles. |
| Next | Release packaging | No EAS build profiles, app icons, native bundle identifiers, or release/deployment workflow. | Configure these when a standalone install/release is wanted; Expo Go preview does not require them. |

## Optional expansion, not implemented or yet specified

Profiles, remote push notifications, friends/following, sharing and post editing
are absent. Journal recovery is available only after the user explicitly links
email/password; anonymous identities remain installation-bound.

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

## v0.5 verification — reactions and local reminders

- Isolated Firebase Emulator Suite run passed with two anonymous identities.
  The first identity added then removed a sparkle; both then added one and the
  aggregate settled at two. The feed returned only the count and the requesting
  viewer's selected state. Direct reads of reaction documents were denied.
- The same run rejected reaction attempts for a private wish and a hidden wish,
  rejected missing and malformed IDs, and retained v0.4 coverage for private
  image isolation, shared-feed anonymity, pagination, and duplicate posting.
- Functions build/lint, mobile typecheck, and 14 regression tests passed. The
  reminder tests cover AM/PM scheduling, cancellation, denied permission, and
  re-scheduling from `America/Toronto` to `Asia/Kolkata` after app resume.
- Expo export for iOS, Android, and web passed. No live Firebase resources or
  data were deployed or changed.
- **User-operated iPhone test, 2026-10-03:** against the local emulator and
  Expo Go development bundle, the user reported that reactions and reminders
  worked. This is a phone observation, separate from the automated checks
  above. The user did not separately report the exact reaction counts, iOS
  permission choice, notification delivery/tap result, or post-disable
  cancellation result, so those specific device behaviors remain unverified.
- Deployment requirement: deploy the v0.5 Functions and Firestore Rules with
  the mobile update. No new Firestore index is required; a first v0.4-or-later
  deployment still includes the reviewed Storage Rules and existing indexes.
  Expo Notifications must be checked in a native app for permission, delivery,
  timezone behavior, and notification taps.

## v0.6 verification — moderation

- Isolated Firebase Emulator Suite run passed with two normal anonymous
  identities and a third identity granted the emulator-only `admin: true`
  custom claim. It accepted one report per identity for an active shared photo,
  rejected unauthenticated, private, missing, duplicate, and rate-limited
  reports, and did not return reporter UIDs in the moderator response.
- A normal identity was denied report review. The admin identity dismissed one
  report and hid the shared wish from the other. After hiding, the test
  confirmed exclusion from the feed, denied direct Firestore reads for both the
  owner and a viewer, denied the authenticated shared-image callable, and
  denied a fresh Storage download URL request under the deployed Storage Rule.
  The owner history callable still returned the hidden journal entry with
  `status: "hidden"`.
- A focused follow-up emulator run verified that an empty moderator queue
  returns an empty list. It then forced a real missing-object metadata failure:
  the post remained hidden from feed and callable access, the report appeared
  as an image-repair item, and retrying after its object path was restored
  completed Storage revocation and returned the queue to its empty state.
- Functions build/lint, mobile TypeScript typecheck, and all 14 existing
  regression tests passed. Expo export completed for iOS, Android, and web.
- Deployment requirement: deploy the v0.6 Functions, Firestore Rules, and
  Firestore indexes together; the new reports query needs the
  `reports(status, createdAt desc)` composite index. Hidden-image denial relies
  on the existing v0.4-or-later Storage Rules, which must be deployed if they
  are not already live. Provision moderator access through a reviewed trusted
  Admin SDK/custom-claim process. No live resources, data, migrations, pushes,
  or merges were performed.

## v0.6 identity/timezone verification

- Two isolated Firebase Emulator Suite runs passed: one at Toronto
  `2026-09-30 18:20 EDT`, and one on the Toronto spring-forward date,
  `2026-03-08 11:11 EDT`. Both exercised the active 11:11 server window using
  the server-owned `America/Toronto` profile.
- The emulator linked email/password credentials to a post-owning anonymous
  identity and verified its UID and existing private history stayed intact. It
  invoked the Firebase Auth password-reset API. A distinct saved account could
  be signed into only after an explicit warning when an anonymous session owned
  wishes. An invalid credential attempt retained that anonymous UID and its
  history; a successful, deliberate sign-in changed identities without merging
  their wishes.
- The same run rejected a caller-supplied timezone on `canPost`, rejected a
  timezone change within 24 hours of posting, allowed a traveler whose last
  timezone change was eight days old to move from Toronto to Auckland, and
  rejected a second immediate change under the seven-day cooldown. A subsequent
  profile initialization returned the stored Auckland timezone, which is the
  refresh path used by the clock on focus and Firebase identity changes.
- Functions build/lint, mobile TypeScript checking, all 14 regression tests, and
  Expo export for iOS, Android, and web passed. No Firebase resources, live
  accounts, data, deploys, pushes, or merges were changed.
- Deployment requirement: enable **Email/Password** alongside Anonymous in
  Firebase Authentication, configure the password-reset email template and
  approved action/continue URL, and deploy the v0.6 identity/timezone Functions
  and Firestore Rules with the mobile update. Existing server-created user
  records without a posting timezone are initialized once from a valid device
  IANA timezone. Physical-device account-linking and timezone-travel behavior
  remain unverified.

## Suggested next milestone

Define the production moderator-claim operation and legacy-image cleanup plan,
then revisit stable identity/timezone policy and media lifecycle. No account or
timezone changes are part of v0.6.
