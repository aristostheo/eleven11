/*
 * Operator-only helper. It prints its intended change unless --apply and the
 * acknowledgement are both present. Run it with ADC in Cloud Shell.
 */
const path = require("node:path");
const functionsRequire = require("node:module").createRequire(path.resolve(__dirname, "../functions/package.json"));
const { getApps, initializeApp, applicationDefault } = functionsRequire("firebase-admin/app");
const { getAuth } = functionsRequire("firebase-admin/auth");

const PROJECT_ID = "eleven11-aristos";
const [action, uid] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
if (!["grant", "revoke"].includes(action) || !uid || uid === "--apply") {
  throw new Error("Usage: node scripts/manage-moderator-claim.cjs <grant|revoke> <uid> [--apply]");
}
if (apply && process.env.ELEVEN11_APPLY_MODERATOR_CLAIM !== "1") {
  throw new Error("--apply also requires ELEVEN11_APPLY_MODERATOR_CLAIM=1");
}

async function main() {
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const auth = getAuth();
  const user = await auth.getUser(uid);
  const currentClaims = user.customClaims || {};
  const nextClaims = { ...currentClaims };
  if (action === "grant") nextClaims.admin = true;
  else delete nextClaims.admin;
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", project: PROJECT_ID, uid, action, currentClaims, nextClaims }, null, 2));
  if (!apply) return;
  await auth.setCustomUserClaims(uid, nextClaims);
  console.log(`Applied ${action} moderator claim. The user must refresh their ID token before testing.`);
}
main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
