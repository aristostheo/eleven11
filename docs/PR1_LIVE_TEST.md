# PR #1 live verification — 2026-09-28

## Scope and safety

PR #1 (`feat/v0.2-server-clock`) was checked against `master` at `6d33545`.
No merge or Firebase deployment was performed. The branch fix changes the client
Storage bucket to the live project bucket, `eleven11-aristos.firebasestorage.app`.

## Local and CI checks

- `npm run typecheck` in `apps/mobile`: passed.
- `npm --prefix functions run build`: passed.
- `npm --prefix functions run lint`: passed.
- `node --test tests/*.test.cjs`: 7 passed, 0 failed.
- `EXPO_OFFLINE=1 CI=1 npx expo export --platform all` on the PR branch:
  web, iOS and Android bundles passed.
- The previous PR CI run passed before this bucket fix. A new CI run is required
  after pushing the fix.

## Live Firebase steps and results

1. `firebase functions:list --project eleven11-aristos --json` confirmed active
   `getServerTime`, `canPost`, and `submitPost` functions in `us-central1`.
2. A Firebase JS client signed in anonymously. Result: passed; an anonymous UID
   and valid ID token were returned.
3. The client called `getServerTime` and `canPost` against the deployed URLs.
   Result: both returned `functions/unauthenticated` / HTTP 401 before function
   execution. Direct HTTP with the anonymous ID token also returned HTTP 401.
   `firebase functions:log --only getServerTime` showed no function log entries,
   indicating an ingress/IAM deployment configuration problem rather than a
   client payload or server-clock calculation failure.
4. A live Storage upload using the corrected bucket returned
   `storage/unknown`. The current deployed Storage rules/configuration were not
   changed, so photo posting and cleanup cannot be accepted as live-passed.
5. The PR Expo server ran at `exp://192.168.4.52:8081`; the paired iPhone was
   detected by `xcrun devicectl` as an available iPhone 16 Pro. This environment
   cannot perform the phone's Expo Go scan/taps, so the UI launch and on-device
   anonymous sign-in remain unverified until the user opens that URL in Expo Go.

## Required follow-up

Before accepting the PR, inspect and correct the deployed callable invoker/IAM
configuration and deploy the reviewed functions/rules through the normal approved
release process. Then run on the iPhone at a real 11:11 window:

1. Open the PR bundle in Expo Go and confirm the clock reaches the synced state.
2. Confirm anonymous sign-in and server-clock display.
3. Submit one text post and record its returned ID.
4. Submit one photo post using a second anonymous test identity and record its ID.
5. Retry each identity's post and confirm `already-exists`.
6. Submit an image with a definitive rejection and verify the uploaded object is
   deleted; simulate a timeout and verify the object is retained for reconciliation.

Until those steps pass, server-clock behavior is locally verified but live posting,
photo storage, 11:11 opening and duplicate rejection remain unverified.
