# 11:11 — Time-Gated Wishes

Expo Router / React Native app with Firebase anonymous authentication, photo uploads,
and callable Cloud Functions. Posting opens for 90 seconds at **11:11 AM and PM** in
the device's timezone, with one post per anonymous account per local calendar day.
The server validates submissions. The current UI includes a clock, composer,
daily feed, personal journal, and local reminder settings. See [project status
and unfinished work](docs/PROJECT_STATUS.md).

Commands below start from the repository root unless stated otherwise.

## Run on your phone with Expo Go

Use Node 22.13+ for mobile development and npm. Cloud Functions are configured
for Node 20; use that runtime when testing the backend.

```bash
cd apps/mobile
npm ci
npx expo start --go --clear
```

Keep your computer and phone on the same Wi-Fi and leave this terminal running.
Scan the terminal QR code using Camera on iPhone or Expo Go's QR scanner on Android.
If your Expo Go version requires sign-in, run `npx expo login` and sign into the
same Expo account in the phone app.

If the phone cannot connect over Wi-Fi:

```bash
npx expo start --go --tunnel
```

Accept Expo's ngrok installation prompt if needed. A tunnel forwards Metro only;
it does not forward Firebase emulators.

**SDK compatibility:** The mobile app targets Expo SDK 57, matching Expo Go
57.0.9 on your iPhone. Sign into the same Expo account in the terminal
(`npx expo login`) and Expo Go before scanning the QR code.

Official instructions: https://docs.expo.dev/get-started/start-developing/

## Firebase setup

The client currently connects to the live `eleven11-aristos` Firebase project
using `apps/mobile/src/lib/firebase.ts`. Starting local emulators does **not**
automatically switch the app to them.

In the Firebase console, verify Anonymous Authentication, Firestore, and Storage
are enabled, and verify the web app config (especially `storageBucket`) matches
this client. Cloud Functions deployment requires billing to be configured.

After reviewing the local changes, deploy the updated functions and rules:

```bash
cd functions
npm ci
cd ..
firebase login
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

Photo uploads use `/uploads/{uid}/{fileName}` and require the updated Storage
rules. Images must be smaller than 3 MB. Posting now uses an atomic daily claim
to reject concurrent duplicates. Keep client and backend updates together.
No deployment is performed by local checks.

## Wish visibility and personal journal

Compose defaults to **Only me**. Those wishes, including their captions and
photos, appear only in **My wishes** for the current Firebase identity.
**Share anonymously** adds a wish to the daily feed without exposing the owner
UID or other account data. Both choices use the same 11:11 window and consume
the same author-local one-post-per-day allowance; visibility cannot be changed
after posting. Private image objects have their upload token removed after the
server verifies object ownership, and are returned only as authenticated private
image data rather than public download-token URLs.

**My wishes** is available from both the clock and daily feed. It spans older
days and supports refresh and pagination. It belongs to the existing Firebase
identity: anonymous account recovery is not implemented, so clearing app data or
changing identity loses access to that journal.

Caption, visibility, and the selected image are saved per Firebase UID while a
draft is pending. Supported devices copy the image into the app's document
directory, so it survives an app restart. A failed submission keeps the draft;
a confirmed post or **Discard draft** clears it.

Existing posts have no visibility field and retain their old shared behavior.
The callable feed treats them as shared during transition. Before tightening
legacy direct-read access, first deploy the v0.4 functions/rules/index and run
a reviewed administrative migration that writes `visibility: "shared"` to each
legacy active post. [scripts/migrate-legacy-shared.cjs](scripts/migrate-legacy-shared.cjs)
is deliberately emulator-only preparation; it refuses production and performs
no changes unless its explicit emulator apply flag is set.

## Daily wish feed

The clock screen always includes **View daily wishes**. The feed reads only
`status: "active"` posts, displays captions, optional images, and the posting
time in the viewer's local timezone, and supports loading, empty, error,
pull-to-refresh, and paginated states. A successful post goes directly to the
feed.

“Today” is each viewer's local calendar day. The feed queries the server
`createdAt` timestamp from that viewer's local midnight through the next local
midnight, so daylight-saving days can be 23 or 25 hours long. Viewers in
different timezones can therefore see different daily sets. This is separate
from `dayKey`, which remains the author's local calendar date and continues to
enforce one post per anonymous account per local day.

Deploy [firestore.indexes.json](firestore.indexes.json) with the Firestore
rules. The feed requires the composite index on `status` and `createdAt`
(descending). Rules allow reads only for active posts; client writes remain
blocked.

## Reporting and moderation

Each shared feed card offers **Report wish** with a reason (spam, abuse,
harassment, or other) and optional details. A signed-in Firebase identity can
report a particular active shared wish once. The callable validates the target,
stores the reporter UID only in the private moderation record, and limits an
identity to five reports per ten minutes. Private, hidden, malformed, missing,
and duplicate targets are rejected.

Only a Firebase identity with the custom claim `{ admin: true }` can load the
**Review reports** screen in Settings or dismiss a report/hide its wish. The
same custom-claim check runs in the review and decision callables; the hidden
screen is only a convenience. Decisions store the action, moderator UID, and
server timestamp. Grant or remove that claim only through a reviewed trusted
Admin SDK process; there is no client-side admin grant flow.

Hiding changes a wish to `status: "hidden"`, so it is excluded from the feed
callable and denied by Firestore Rules, including direct client reads. The app
does not return shared download-token URLs. It fetches an active shared image
through an authenticated callable; hiding marks the object `hidden`, clears its
download token, and the Storage Rule denies new reads. My wishes keeps the
owner's caption and marks the wish hidden, but does not serve its shared image.

This cannot recall an image that someone already downloaded, copied, or
screenshotted. Legacy posts with an old `media.url` can likewise retain an
already-known URL until a reviewed migration/Storage cleanup revokes it; the
current app and feed callable no longer return that field.

Deploy the Functions, Firestore Rules/indexes, and app update together. The
existing reviewed visibility-aware Storage Rules are required for hidden-image
read denial; deploy them too only if the live project has not already received
the v0.4-or-later rules. The new composite
`reports(status, createdAt desc)` index is in
[firestore.indexes.json](firestore.indexes.json).

## Reactions and local reminders

Each active shared wish has one **✨** toggle per signed-in Firebase identity.
The count and that viewer's selected state come from a callable; reaction
documents and direct count updates are blocked by Firestore Rules. Reactions are
available outside a posting window. Private and non-active wishes cannot be
reacted to, and the feed never returns reaction identities.

**Settings** on the clock screen lets a user enable local 11:11 AM reminders,
PM reminders, or both. The setting stays on the device. Permission is requested
only when turning on a reminder; a denial leaves the choice visible and explains
how to enable notifications in iPhone Settings. Scheduled notifications follow
the device timezone and are rebuilt when the app resumes after a timezone
change. Disabling a period cancels its local notification. These are local Expo
notifications, not remote push notifications.

Deploy the v0.5 Functions and Firestore Rules with the app update. No new
Firestore index is required; a first v0.4-or-later deployment also needs the
reviewed Storage Rules and existing indexes described above. A native-device
check is still required for the permission dialog, scheduling, cancellation,
timezone change, and notification tap behavior.

In development, **Preview compose** lets you inspect the composer at any time.
It does not bypass server posting restrictions. Release builds hide this link.
Outside a posting window, the disabled submit button is expected.

## Reproducible installs

Both packages include `.npmrc` files recording the `legacy-peer-deps` mode used
to generate their lockfiles. Run `npm ci` inside the package directory so local
and CI installs use the same dependency resolution. Expo dependency checks and
bundle exports validate the supported native package versions separately.

## Checks

```bash
npm --prefix apps/mobile run typecheck
npm --prefix functions run build
npm --prefix functions run lint
node --test tests/*.test.cjs
cd apps/mobile
npx expo export --platform all
```

The regression tests cover AM/PM window boundaries, timezone/daylight-saving
rollover, timezone validation, rejecting phone-local image URLs, callable
validation/concurrent submissions, sparkle toggling, and local reminder
scheduling. The emulator smoke test also exercises the moderation flow.
Bundling and these checks do not verify live Firebase credentials, deployment,
or native interactions. Confirm sign-in, photo selection/upload, posting,
duplicate rejection, notification permission, scheduled reminders, and the
moderator custom claim on a device against your configured backend.

## Known scope limits

Anonymous identity belongs to an installation; clearing app storage can create a
new account. Timezones are supplied by the client. A stronger per-person limit
would require account and timezone policy beyond this starter. Uploaded photos
can remain unused if submission fails after upload.
