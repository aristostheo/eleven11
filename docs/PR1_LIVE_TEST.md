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

1. Project identity was verified with Firebase APIs: project ID
   `eleven11-aristos`, project number `1071072560179`, active Firebase project,
   web app ID `1:1071072560179:web:9e125149447e79203dcf46`. The checked-in client
   uses the same project ID/app ID and `us-central1` Functions region.
2. Cloud Functions REST metadata verified all three deployed endpoints as Firebase
   **Gen 1** (`gcfv1`), region `us-central1`, runtime Node 20, ingress
   `ALLOW_ALL`, security level `SECURE_ALWAYS`:
   - `https://us-central1-eleven11-aristos.cloudfunctions.net/getServerTime`
   - `https://us-central1-eleven11-aristos.cloudfunctions.net/canPost`
   - `https://us-central1-eleven11-aristos.cloudfunctions.net/submitPost`
3. A Firebase JS client signed in anonymously. Result: passed; an anonymous UID
   and valid ID token were returned. Decoded non-secret claims were:
   `iss=https://securetoken.google.com/eleven11-aristos`,
   `aud=eleven11-aristos`, `firebase.sign_in_provider=anonymous`, and a valid
   `iat`/`exp`. The issuer and audience match the deployed project.
4. The client SDK and a direct HTTP request with that token both called
   `getServerTime` and `canPost`; both returned `functions/unauthenticated`
   and HTTP 401. The direct response was an HTML Google 401 response. Firebase
   function logs contained no invocation entries.
5. App Check was checked through the Firebase App Check REST API for project
   number `1071072560179`. Auth, Firestore, and Storage all returned a service
   config with no `enforcementMode` (the default `OFF`). App Check is therefore
   not the source of the 401.
6. The Cloud Functions v1 IAM policy endpoint returned an empty policy (etag only,
   no bindings). The function metadata says `ALLOW_ALL`, but Cloud Run Admin API
   is disabled for the project, so the underlying managed service policy could
   not be read. This proves a platform-level invocation configuration remains
   unresolved, but does not justify changing IAM blindly. No IAM change was made.
7. The client’s endpoint and token claims are correct; the 401 occurs before the
   handler and is not caused by `getServerTime` payload validation or the PR clock
   code.
8. The configured Storage bucket was checked directly. `GET
   https://storage.googleapis.com/storage/v1/b/eleven11-aristos.firebasestorage.app`
   returned HTTP 404 `The specified bucket does not exist.` Listing all project
   buckets returned only `gcf-sources-1071072560179-us-central1`, the Cloud
   Functions source bucket. A raw authenticated Firebase Storage media upload to
   the configured bucket returned HTTP 404 `Not Found`; the Firebase JS SDK
   surfaced this as `storage/unknown`. The bucket must be provisioned before any
   Storage rule or upload test can pass.
9. Firebase Rules API listed only a `cloud.firestore` release; no Storage rules
   release was present. The checked-in `/uploads/{uid}/{fileName}` rules have not
   been deployed. No rules or bucket changes were made.
10. The PR Expo server ran at `exp://192.168.4.52:8081`; the paired iPhone was
   detected by `xcrun devicectl` as an available iPhone 16 Pro. This environment
   cannot perform the phone's Expo Go scan/taps, so the UI launch and on-device
   anonymous sign-in remain unverified until the user opens that URL in Expo Go.

## Required follow-up

Before accepting the PR, inspect the managed callable invoker configuration and
provision the expected Storage bucket, then present the exact IAM/bucket/rules
changes for approval before any deployment. Deploy the reviewed functions/rules
only through the normal approved release process. Then run on the iPhone at a real
11:11 window:

1. Open the PR bundle in Expo Go and confirm the clock reaches the synced state.
2. Confirm anonymous sign-in and server-clock display.
3. Submit one text post and record its returned ID.
4. Submit one photo post using a second anonymous test identity and record its ID.
5. Retry each identity's post and confirm `already-exists`.
6. Submit an image with a definitive rejection and verify the uploaded object is
   deleted; simulate a timeout and verify the object is retained for reconciliation.

Until those steps pass, server-clock behavior is locally verified but live posting,
photo storage, 11:11 opening and duplicate rejection remain unverified.
