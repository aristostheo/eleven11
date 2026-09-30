/*
 * Prepare the backwards-compatible visibility migration in the Firestore
 * emulator only. Production data is intentionally refused: run a reviewed
 * administrative migration separately after the v0.4 rules/functions deploy.
 */
const { getApps, initializeApp } = require("../functions/node_modules/firebase-admin/app");
const { getFirestore } = require("../functions/node_modules/firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("This local preparation script only runs against FIRESTORE_EMULATOR_HOST.");
}
if (!getApps().length) initializeApp({ projectId: "eleven11-aristos" });

async function main() {
  const db = getFirestore();
  const legacy = await db.collection("posts").where("status", "==", "active").get();
  const candidates = legacy.docs.filter((post) => post.get("visibility") === undefined);
  console.log(JSON.stringify({ candidates: candidates.map((post) => post.id), count: candidates.length }));
  if (process.env.ELEVEN11_APPLY_EMULATOR_LEGACY_MIGRATION !== "1") return;
  const batch = db.batch();
  candidates.forEach((post) => batch.update(post.ref, { visibility: "shared", legacyShared: true }));
  if (candidates.length) await batch.commit();
  console.log(`Marked ${candidates.length} emulator legacy posts as shared.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
