# v0.6 live cutover — `eleven11-aristos`

This is an operator runbook, not a deployment record. This preparation made no
Firebase changes. Use a short maintenance window: the live v0.2 functions use
the old timezone-carrying post payload, while merged v0.6 expects server-owned
posting profiles and new callable endpoints. Old and new clients cannot safely
run against the other backend contract.

## Prepared rollback artifacts

`ops/v06-live-cutover/rollback/` contains review copies of exact read-only
snapshots of the currently released rules, fetched on 2026-10-05. Their secure
rollback copies are outside Git at
`/Users/aristos/Documents/.eleven11-cutover-archives/2026-10-05/` with mode
`0700` on the directory and `0600` on files:

| File | SHA-256 |
| --- | --- |
| `firestore-live.rules` | `5144de0d5bb7c43194b149a18b01406e6b45733e2ec4c2c7ee3cbb34d1a47ce6` |
| `storage-live.rules` | `9965a53006857cb15f22c50cab59668a07c2bac1bf2e986927225f859f4b516b` |

`functions-manifest.json` records the three active Gen 1 Functions in
`us-central1`. All point at the same source object,
`gs://uploads-392201582289.us-central1.cloudfunctions.appspot.com/f4945aeb-3da3-495b-89c5-e03915b7cb79.zip`.
Authenticated, read-only inspection received `storage.objects.get` HTTP 403;
the same principal received HTTP 403 for `storage.buckets.getIamPolicy`. The
source object was therefore not downloaded. Before approving the cutover, an
operator who already has source-object read access must archive it (this only
reads the deployed source):

```bash
cd /Users/aristos/Documents/eleven11
archive_dir=/Users/aristos/Documents/.eleven11-cutover-archives/2026-10-05
node scripts/archive-v06-live-rollback.cjs "$archive_dir"
gzip -t "$archive_dir/functions-gen1-source.zip"
shasum -a 256 "$archive_dir/functions-gen1-source.zip"
```

Do not add broad Storage access merely to bypass this safeguard. If an approved
operator cannot archive the exact source, stop the cutover; rollback is
incomplete.

### Reproducible repository fallback — not an equivalent archive

The exact ZIP remains unavailable. As a clearly labeled fallback, the
repository's only commit before the three Functions' 2025-11-13 deployment,
`63555ea6c31ff4af67629e64a478e8367250ef34` (`chore: bootstrap eleven11
starter`, tree `0cc1981b18095888df20197fb76d59a9bc514a28`), was archived outside
Git as `functions-repository-candidate-63555ea.tar.gz`.

Its SHA-256 is
`839b9371973edf6767f016dd068cfba9c9e15be20fbf36bd790584d528466aa7`; `gzip
-t` succeeded. Live read-only callable probes provide behavioral evidence for
this candidate: `getServerTime({})` returned HTTP 200 with `result.serverMillis`,
`canPost({})` returned HTTP 400 `Bad payload`, and
`canPost({tzId:"UTC",clientNow:0})` without Auth returned HTTP 401 `Login
required`. Those are the v0.2 source contract in that commit and differ from
merged v0.6, whose unauthenticated `canPost({})` would fail Auth before parsing.

This is behavioral/version-timing evidence only. It is **not** proof that the
candidate tarball equals the deployed ZIP and it must not be treated as the
exact live-source rollback archive.

## Verified legacy migration dry run

`scripts/migrate-v06-legacy-posts.cjs` targets only the two verified active
legacy documents. It needs Application Default Credentials for the production
project, defaults to dry-run, refuses unexpected post counts or image paths,
and requires both `--apply` and `ELEVEN11_APPLY_V06_LEGACY_MIGRATION=1` to
write. On retry it selects the same two records through `legacyShared: true`,
so its missing work is idempotent.

The following is the exact 2026-10-05 dry run. It made no write and did **not**
clear any token:

```json
{
  "mode": "dry-run",
  "project": "eleven11-aristos",
  "expectedLegacyPosts": 2,
  "posts": [
    {
      "firestore": {
        "document": "posts/BGwYbjDfJIy7ZTS3vrDm",
        "changes": { "visibility": "shared", "legacyShared": true }
      },
      "storage": null
    },
    {
      "firestore": {
        "document": "posts/vwoIjk2bbA3llTem1Tls",
        "changes": {
          "visibility": "shared",
          "legacyShared": true,
          "media.storagePath": "uploads/muOI6y4DbjPALeiBYqysSaKQHSs2/live-photo-1790626302.png",
          "media.url": "[delete]"
        }
      },
      "storage": {
        "bucket": "eleven11-aristos.firebasestorage.app",
        "object": "uploads/muOI6y4DbjPALeiBYqysSaKQHSs2/live-photo-1790626302.png",
        "currentMetadata": {
          "contentType": "image/png",
          "size": "68",
          "metadata": { "firebaseStorageDownloadTokens": "[present; will be cleared]" }
        },
        "changes": {
          "ownerUid": "muOI6y4DbjPALeiBYqysSaKQHSs2",
          "visibility": "shared",
          "firebaseStorageDownloadTokens": "[clear]"
        }
      }
    }
  ]
}
```

The approved live apply would label both documents shared. For the image it
verifies the object and image type, writes the verified storage path, deletes
the legacy download URL field, sets owner/visibility metadata, and clears the
existing Firebase download token. Previously downloaded or copied images
cannot be recalled. Re-run the dry run immediately before maintenance:

```bash
cd /Users/aristos/Documents/eleven11
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/cutover-service-account.json \
  node scripts/migrate-v06-legacy-posts.cjs
```

## Prerequisites requiring a decision

1. In Firebase Console → Authentication → Sign-in method, enable
   **Email/Password** and keep Anonymous enabled. In Authentication →
   Templates, review the password-reset sender/template. The app uses
   Firebase's default `sendPasswordResetEmail` handler without custom action
   settings; do not configure a custom handler/continue URL for this release.
2. Deploy and wait for `READY` on the three checked-in indexes:
   `posts(status ASC, createdAt DESC)`, `posts(uid ASC, createdAt DESC)`, and
   `reports(status ASC, createdAt DESC)`. Firestore is in
   `northamerica-northeast2`; Functions/Storage are already in `us-central1`.
   That existing regional split may affect latency/cost and is not changed here.
3. Choose an audited moderator Auth UID. No claim is assigned by this work.
4. Decide how to distribute the matching mobile bundle. Expo Go is appropriate
   for acceptance testing, not a public release channel.

## Ordered maintenance cutover

Stop if any expected result fails. Keep maintenance on until the matching app
has passed acceptance.

1. Announce maintenance and block new posts/sessions. Start from a clean
   checkout of this merged `master`; run the checks below and complete the
   Functions source archive.
2. Enable Email/Password and review the **default** reset template, as above;
   retain Anonymous.
3. Deploy indexes first and wait for all to be ready:

   ```bash
   firebase use eleven11-aristos
   firebase deploy --only firestore:indexes
   firebase firestore:indexes
   ```

4. Deploy all merged Functions, then list them. Confirm all 15 exports are in
   `us-central1`. Verify Gen 1 callable invocation access per function; handler
   Firebase Auth/moderator checks still control product access.

   ```bash
   firebase deploy --only functions
   firebase functions:list
   ```

   Each callable needs the same function-scoped
   `roles/cloudfunctions.invoker` binding for `allUsers` as the existing
   Firebase client callables: invocation must reach the callable protocol so
   Firebase Auth tokens can be checked in the handler. It does not grant access
   to an authenticated operation. Verify each binding; do not set project-wide
   IAM:

   ```bash
   for fn in getServerTime initializePostingProfile getPostingProfile getIdentityStatus \
     updatePostingTimezone canPost submitPost getDailyWishes toggleSparkleReaction \
     reportWish getModerationReports decideModerationReport getSharedImage \
     getMyWishes getPrivateImage; do
     gcloud functions get-iam-policy "$fn" --region=us-central1 \
       --format='table(bindings.role,bindings.members)'
   done
   ```

5. Run the approved migration during maintenance, then repeat its dry-run. The
   second result must show the same targets with no remaining field change:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/cutover-service-account.json \
     ELEVEN11_APPLY_V06_LEGACY_MIGRATION=1 \
     node scripts/migrate-v06-legacy-posts.cjs --apply
   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/cutover-service-account.json \
     node scripts/migrate-v06-legacy-posts.cjs
   ```

6. Deploy Storage Rules, then Firestore Rules. This keeps shared object reads
   available to the callable before direct legacy Firestore reads are removed.

   ```bash
   firebase deploy --only storage
   firebase deploy --only firestore:rules
   ```

7. Run callable/iPhone acceptance. Publish the matching mobile build only after
   it passes, then end maintenance.

## Moderator claim procedure (not executed)

Use ADC in a controlled Cloud Shell/administrator environment. First inspect
the planned claim merge; use a UID, never an email address in shell history:

```bash
cd /Users/aristos/Documents/eleven11
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/cutover-service-account.json \
  node scripts/manage-moderator-claim.cjs grant MODERATOR_UID
```

After independent review of the UID and displayed existing claims, apply it:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/cutover-service-account.json \
  ELEVEN11_APPLY_MODERATOR_CLAIM=1 \
  node scripts/manage-moderator-claim.cjs grant MODERATOR_UID --apply
```

Record UID, operator, approver, timestamp, and reason in the access log. The
moderator must refresh their ID token before testing. Replace `grant` with
`revoke` to remove access, again reviewing its dry-run first.

## Callable and iPhone acceptance

First verify the clock and unauthenticated posting guard:

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' -d '{"data":{}}' \
  https://us-central1-eleven11-aristos.cloudfunctions.net/getServerTime
curl -sS -o /tmp/eleven11-can-post-no-auth.json -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{"data":{}}' \
  https://us-central1-eleven11-aristos.cloudfunctions.net/canPost
cat /tmp/eleven11-can-post-no-auth.json
```

Expected: `getServerTime` HTTP 200 with `serverMillis`; unauthenticated
`canPost` must be a callable authentication error. An authenticated
`canPost({})` should return the server profile's window/day result.

Launch the iPhone acceptance app against live Firebase (do not set emulator
variables):

```bash
cd /Users/aristos/Documents/eleven11/apps/mobile
npm ci
npx expo start --go --lan --clear
```

With Expo Go SDK 57 on the same Wi-Fi, scan the QR code and record exact results:

1. Verify the clock reloads the server-saved timezone after Settings returns.
2. At a server-saved 11:11 window, submit one **Only me** text/photo wish;
   verify it appears only in My wishes and its photo loads.
3. Verify its draft clears; a second post by that identity, even after changing
   visibility, is rejected for the local day.
4. With a fresh test identity, submit one **Share anonymously** photo wish;
   verify Daily wishes shows no UID/email and the owner sees it in My wishes.
5. Link a fresh email/password identity, request a reset, and complete
   Firebase's default reset email flow. Do not mark it verified merely because
   the reset request returns success.
6. If a claim was separately approved, submit/report/hide a test shared wish.
   Verify feed/image exclusion and explain that an already downloaded image
   cannot be recalled.

## Rollback

Keep maintenance on. Restore the archived Rules and redeploy the archived Gen
1 Functions source as one coordinated rollback with the old mobile client. Do
not roll back only one side of the callable contract. The legacy migration is
forward-compatible (`visibility: shared`, `legacyShared`, and object metadata);
do not remove those fields in an incident. Do not restore a cleared download
token. If the exact Functions ZIP is absent, stop and obtain it before release.

## Local checks

```bash
npm --prefix apps/mobile run typecheck
npm --prefix functions run build
npm --prefix functions run lint
node --test tests/*.test.cjs
cd apps/mobile && npx expo export --platform all
```
