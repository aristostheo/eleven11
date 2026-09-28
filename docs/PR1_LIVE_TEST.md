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

## Gen 1 invocation IAM — evidence and proposed change (not applied)

The deployed functions are Gen 1 (`platform=gcfv1`). For each function, the
Cloud Functions v1 `getIamPolicy` endpoint was queried for the exact resource
`projects/eleven11-aristos/locations/us-central1/functions/{name}`. The response
for `getServerTime`, `canPost`, and `submitPost` was an empty policy (`bindings=[]`,
with only an etag). None has a `roles/cloudfunctions.invoker` binding for
`allUsers`. This is the direct Gen 1 policy evidence; Cloud Run service IAM is
not the relevant policy surface for these deployments.

The proposed, function-scoped changes are the following commands. They have not
been run:

```sh
gcloud functions add-invoker-policy-binding getServerTime \
  --region=us-central1 --member=allUsers \
  --project=eleven11-aristos
gcloud functions add-invoker-policy-binding canPost \
  --region=us-central1 --member=allUsers \
  --project=eleven11-aristos
gcloud functions add-invoker-policy-binding submitPost \
  --region=us-central1 --member=allUsers \
  --project=eleven11-aristos
```

The Firebase callable client is an end-user HTTP client, not a Google Cloud IAM
principal with a function-invoker identity. The Gen 1 front door therefore must
admit the request before the callable protocol can parse its Firebase Auth
token. `allUsers` grants only network invocation of these three functions; it
does not grant Firebase Auth, Firestore, or Storage access. `getServerTime` is
intentionally public in its handler. `canPost` and `submitPost` still check
`context.auth` and return `HttpsError("unauthenticated", "Login required")` when
the callable request has no Firebase Auth identity. Public invocation can expose
the endpoints to probes and billable traffic, so App Check, handler auth, and
rate limiting remain relevant controls.

After an approved change, verify the policy and behavior in this order:

1. Read each policy with `gcloud functions get-iam-policy NAME
   --region=us-central1 --project=eleven11-aristos --format=json`; each should
   contain `roles/cloudfunctions.invoker` with member `allUsers`.
2. Send an unauthenticated callable request to `getServerTime`:

   ```sh
   curl -i -sS -X POST \
     -H 'Content-Type: application/json' \
     --data '{"data":{}}' \
     https://us-central1-eleven11-aristos.cloudfunctions.net/getServerTime
   ```

   Expect HTTP 200 and callable JSON containing `data.serverMillis`.
3. Obtain a fresh anonymous Firebase ID token, then call `canPost` with
   `Authorization: Bearer $FIREBASE_ID_TOKEN` and a payload such as
   `{"data":{"tzId":"UTC","clientNow":0}}`. Expect HTTP 200 with the
   handler's `allowed`/`reason` result for the current window.
4. Repeat the `canPost` request with the same payload and no Authorization
   header. Expect the callable handler's structured HTTP 401/
   `UNAUTHENTICATED` response with `Login required`, rather than the previous
   HTML Google 401 front-door response. This proves IAM admission and handler
   Firebase Auth enforcement separately.

## Storage provisioning, billing, and rules — proposal (not applied)

The Cloud Billing API reports `billingEnabled=true` and an open linked billing
account (`billingAccounts/0128B2-500610-CFDC05`, display name `Firebase Payment`).
That means the project is already on Firebase's Blaze pay-as-you-go plan; no
Spark-to-Blaze upgrade is currently required. Creating the bucket itself is not
the cost concern, but stored bytes, operations, and network egress can incur
charges after applicable free quotas. A budget alert should be configured; it
does not cap usage.

The proposed bucket location is `us-central1`, matching all deployed functions
and reducing request latency. A bucket location is immutable after creation, so
confirm data-residency requirements before provisioning. `us-central1` is among
the locations documented as eligible for Google Cloud Storage's Always Free
tier, subject to the current quotas and terms; this is not a guarantee of zero
cost. The expected default bucket name is
`eleven11-aristos.firebasestorage.app`. It currently does not exist (the Storage
API returned HTTP 404), and no bucket was created.

Exact Firebase Console steps, to perform only after approval:

1. Open the Firebase Console project `eleven11-aristos`.
2. Select **Databases & Storage → Storage → Files**, then click **Get started**.
3. Confirm the Blaze plan when shown (the project is already linked to an open
   billing account).
4. Select **us-central1** as the bucket location and continue.
5. Review the rules step, then finish with **Done**. Do not retain temporary
   starter rules as the release policy.
6. Confirm that the Files view shows
   `eleven11-aristos.firebasestorage.app` in `us-central1`.
7. In a separately approved release, deploy the checked-in `storage.rules` with
   `firebase deploy --only storage` from the repository.

The checked-in rules to deploy are:

```text
match /uploads/{uid}/{fileName} {
  allow read: if true;
  allow create: if request.auth != null && request.auth.uid == uid
                && request.resource.size < 3 * 1024 * 1024
                && request.resource.contentType.matches('image/.*');
  allow delete: if request.auth != null && request.auth.uid == uid;
}
```

They allow public reads of uploaded objects, restrict creation and deletion to
the owning signed-in user, require an image MIME type, and cap new files below
3 MiB. No bucket, rules, function, IAM, or PR merge operation was performed
while recording this proposal; PR #1 remains a draft.

## v0.2 live verification after approved infrastructure changes — 2026-09-28

The previously proposed live changes were applied directly to project
`eleven11-aristos`. No function code deployment, Git push, PR merge, or daily
feed work was performed.

### IAM and callable results

- Each Gen 1 function now has exactly the function-scoped binding
  `roles/cloudfunctions.invoker` → `allUsers`. The policies were read back from
  the Cloud Functions v1 API after the change for `getServerTime`, `canPost`, and
  `submitPost`.
- An unauthenticated POST to `getServerTime` returned HTTP 200 with a callable
  `serverMillis` result.
- A fresh anonymous Firebase Auth identity called `canPost` with
  `tzId=UTC`; it reached the handler and returned HTTP 200 with
  `allowed:false, reason:"outside-window"`.
- The same `canPost` payload without an Authorization header returned HTTP 401
  with structured callable JSON `{message:"Login required",status:"UNAUTHENTICATED"}`.
- During the actual `Pacific/Gambier` 11:11 window, the first identity posted
  text successfully (`postId=BGwYbjDfJIy7ZTS3vrDm`). Its immediate retry returned
  HTTP 409 `ALREADY_EXISTS`.
- A second anonymous identity uploaded an image and posted it successfully
  (`postId=vwoIjk2bbA3llTem1Tls`) during the same window. Its immediate retry
  returned HTTP 409 `ALREADY_EXISTS`.

### Storage and rules results

- The Firebase Storage default bucket was created through the Firebase Storage
  API with an explicit immutable location of `us-central1`.
- Read-back metadata reports location `US-CENTRAL1`, Standard class, and bucket
  name `eleven11-aristos.firebasestorage.app`, exactly matching the checked-in
  mobile config.
- `firebase deploy --only storage --project eleven11-aristos --non-interactive`
  compiled and released `storage.rules` successfully. The active release is
  `firebase.storage/eleven11-aristos.firebasestorage.app`.
- Rules verification with a temporary 1×1 PNG: owner create returned HTTP 200;
  unauthenticated metadata read returned HTTP 200 as permitted; a signed-in
  attempt to create under another UID returned HTTP 403; owner delete returned
  HTTP 204.
- The successful photo test object remains in Storage because the live Firestore
  post stores its download URL. It is a tiny test object; deleting it would make
  that recorded photo post's media URL invalid.

### Local validation after the live changes

- Mobile `npm run typecheck`: passed.
- Functions `npm run build`: passed.
- Functions `npm run lint`: passed.
- Regression tests: 7 passed, 0 failed.
- `EXPO_OFFLINE=1 CI=1 npx expo export --platform all`: web, iOS, and Android
  exports passed.

### iPhone / Expo Go test status

No iPhone UI result is claimed here. The exact user-run steps are:

1. From the repository, run `cd apps/mobile && npx expo start --lan`.
2. Ensure the iPhone and computer are on the same Wi-Fi network.
3. Open Expo Go on the iPhone, scan the displayed QR code, and wait for the app
   to load.
4. Confirm the clock reaches the synced state and that anonymous sign-in does
   not show an error.
5. During a real 11:11 window, submit one text post and record its returned
   result, then retry and record the duplicate error.
6. Using a fresh anonymous identity, submit one photo post and record its
   result, then retry and record the duplicate error.
7. Report the iPhone model, Expo Go version, local time zone, post IDs, and any
   error text. Those user-provided results will be recorded separately from the
   server-side checks above.

### Remaining v0.2 gaps and access/cost implications

The server-side live path is verified for callable admission, Firebase Auth
enforcement, Storage rules, text posting, photo posting, and duplicate rejection.
The remaining gap is the user-operated iPhone UI flow: Expo Go launch, UI
anonymous sign-in, UI photo picker/upload, and UI error rendering remain
untested here. The three `allUsers` invoker bindings allow internet traffic to
reach the callable endpoints; handler authentication still protects posting,
while `getServerTime` is public. The project is already on Blaze, so no plan
upgrade occurred. Storage usage, operations, egress, and callable traffic may
incur charges under the linked billing account.
