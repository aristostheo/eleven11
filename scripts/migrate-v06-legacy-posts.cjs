/*
 * One-time v0.6 production migration for the two verified legacy posts.
 *
 * This script is deliberately dry-run by default. It refuses any unexpected
 * legacy shape, and writes only after both --apply and the explicit
 * ELEVEN11_APPLY_V06_LEGACY_MIGRATION=1 acknowledgement are supplied.
 *
 * It requires Application Default Credentials for the target project, for
 * example from an operator's Cloud Shell session or a short-lived service
 * account credential. It never accepts a Firebase client credential.
 */
const path = require("node:path");
const functionsRequire = require("node:module").createRequire(path.resolve(__dirname, "../functions/package.json"));
const { getApps, initializeApp, applicationDefault } = functionsRequire("firebase-admin/app");
const { getFirestore, FieldValue } = functionsRequire("firebase-admin/firestore");
const { getStorage } = functionsRequire("firebase-admin/storage");

const PROJECT_ID = "eleven11-aristos";
const BUCKET = "eleven11-aristos.firebasestorage.app";
const EXPECTED_LEGACY_POSTS = 2;
const apply = process.argv.includes("--apply");

function fail(message) {
  throw new Error(`v0.6 legacy migration refused: ${message}`);
}

function storagePathFromUrl(url, bucket, uid) {
  if (typeof url !== "string") fail("an image legacy post has no media.url");
  let parsed;
  try { parsed = new URL(url); } catch { fail("media.url is not a URL"); }
  const prefix = `/v0/b/${bucket}/o/`;
  if (parsed.hostname !== "firebasestorage.googleapis.com" || !parsed.pathname.startsWith(prefix)) {
    fail("media.url is not a Firebase download URL for the configured bucket");
  }
  const storagePath = decodeURIComponent(parsed.pathname.slice(prefix.length));
  if (!new RegExp(`^uploads/${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^/]+$`).test(storagePath)) {
    fail("image object is not in uploads/{post.uid}/{fileName}");
  }
  return storagePath;
}

function redactedMetadata(metadata) {
  const custom = { ...(metadata.metadata || {}) };
  if (custom.firebaseStorageDownloadTokens) custom.firebaseStorageDownloadTokens = "[present; will be cleared]";
  return {
    contentType: metadata.contentType || null,
    size: metadata.size || null,
    metadata: custom,
  };
}

async function planPost(post, bucket) {
  const data = post.data();
  if (data.status !== "active") fail(`${post.id} is not active`);
  if (typeof data.uid !== "string" || !data.uid) fail(`${post.id} has no uid`);
  const media = data.media || { type: "none" };
  const firestoreChanges = {};
  if (data.visibility !== "shared") firestoreChanges.visibility = "shared";
  if (data.legacyShared !== true) firestoreChanges.legacyShared = true;

  const plan = {
    firestore: {
      document: post.ref.path,
      changes: firestoreChanges,
    },
    storage: null,
    _apply: async () => {
      if (Object.keys(firestoreChanges).length) await post.ref.update(firestoreChanges);
    },
  };

  if (media.type === "none" || !media.type) return plan;
  if (media.type !== "image") fail(`${post.id} has unsupported media type ${String(media.type)}`);

  const storagePath = typeof media.storagePath === "string"
    ? media.storagePath
    : storagePathFromUrl(media.url, BUCKET, data.uid);
  if (!new RegExp(`^uploads/${data.uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^/]+$`).test(storagePath)) {
    fail(`${post.id} has an image path outside its owner upload folder`);
  }
  const file = bucket.file(storagePath);
  let object;
  try { [object] = await file.getMetadata(); } catch { fail(`${post.id} image object ${storagePath} was not found`); }
  if (!object.contentType || !object.contentType.startsWith("image/")) {
    fail(`${post.id} image object does not have an image content type`);
  }
  const existingMetadata = object.metadata || {};
  const desiredMetadata = { ...existingMetadata };
  const storageChanges = {};
  if (existingMetadata.ownerUid !== data.uid) {
    desiredMetadata.ownerUid = data.uid;
    storageChanges.ownerUid = data.uid;
  }
  if (existingMetadata.visibility !== "shared") {
    desiredMetadata.visibility = "shared";
    storageChanges.visibility = "shared";
  }
  if (existingMetadata.firebaseStorageDownloadTokens) {
    desiredMetadata.firebaseStorageDownloadTokens = null;
    storageChanges.firebaseStorageDownloadTokens = "[clear]";
  }
  if (media.storagePath !== storagePath) firestoreChanges["media.storagePath"] = storagePath;
  if (typeof media.url === "string") firestoreChanges["media.url"] = "[delete]";
  if (Object.keys(storageChanges).length) {
    plan.storage = {
      bucket: BUCKET,
      object: storagePath,
      currentMetadata: redactedMetadata(object),
      changes: storageChanges,
    };
  }
  plan._apply = async () => {
    // Do storage first. Re-running is safe if the subsequent Firestore update
    // is interrupted, and the maintenance window keeps the object unserved.
    if (Object.keys(storageChanges).length) await file.setMetadata({ metadata: desiredMetadata });
    const updates = { ...firestoreChanges };
    if (updates["media.url"] === "[delete]") updates["media.url"] = FieldValue.delete();
    if (Object.keys(updates).length) await post.ref.update(updates);
  };
  return plan;
}

async function main() {
  if (apply && process.env.ELEVEN11_APPLY_V06_LEGACY_MIGRATION !== "1") {
    fail("--apply also requires ELEVEN11_APPLY_V06_LEGACY_MIGRATION=1");
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();
  const bucket = getStorage().bucket(BUCKET);
  const active = await db.collection("posts").where("status", "==", "active").get();
  // On first run this finds the two unlabeled legacy posts. On a retry it
  // selects the same two documents by their migration marker.
  const targets = active.docs.filter((post) => post.get("visibility") === undefined || post.get("legacyShared") === true);
  if (targets.length !== EXPECTED_LEGACY_POSTS) {
    fail(`expected exactly ${EXPECTED_LEGACY_POSTS} legacy targets, found ${targets.length}`);
  }
  const plans = [];
  for (const post of targets.sort((a, b) => a.id.localeCompare(b.id))) plans.push(await planPost(post, bucket));
  const output = {
    mode: apply ? "apply" : "dry-run",
    project: PROJECT_ID,
    expectedLegacyPosts: EXPECTED_LEGACY_POSTS,
    posts: plans.map(({ _apply, ...plan }) => plan),
  };
  console.log(JSON.stringify(output, null, 2));
  if (!apply) return;
  for (const plan of plans) await plan._apply();
  console.log("Applied v0.6 legacy migration. Re-run without --apply to verify an idempotent no-op.");
}

main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
