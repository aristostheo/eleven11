# 11:11 — Time-Gated Wishes

Expo Router / React Native app with Firebase anonymous authentication, photo uploads,
and callable Cloud Functions. Posting opens for 90 seconds at **11:11 AM and PM** in
the device's timezone, with one post per anonymous account per local calendar day.
The server validates submissions. The current UI contains a clock and composer;
there is no feed or collage screen yet. See [project status and unfinished work](docs/PROJECT_STATUS.md).

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
firebase deploy --only functions,firestore:rules,storage
```

Photo uploads use `/uploads/{uid}/{fileName}` and require the updated Storage
rules. Images must be smaller than 3 MB. Posting now uses an atomic daily claim
to reject concurrent duplicates. Keep client and backend updates together.
No deployment is performed by local checks.

In development, **Preview compose** lets you inspect the composer at any time.
It does not bypass server posting restrictions. Release builds hide this link.
Outside a posting window, the disabled submit button is expected.

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
rollover, timezone validation, rejecting phone-local image URLs, and callable
validation/concurrent submissions using an in-memory transaction adapter. Bundling
and these checks do not verify live Firebase credentials, deployment, or native
interactions. Confirm sign-in, photo selection/upload, posting, and duplicate
rejection on a device against your configured backend.

## Known scope limits

Anonymous identity belongs to an installation; clearing app storage can create a
new account. Timezones are supplied by the client. A stronger per-person limit
would require account and timezone policy beyond this starter. Uploaded photos
can remain unused if submission fails after upload.
