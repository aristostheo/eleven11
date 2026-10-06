/*
 * Read-only rollback archive helper for the v0.6 cutover. It uses the logged
 * in Firebase CLI account, downloads only the currently deployed Gen 1
 * Functions source bundle, and copies Rules source supplied by the caller.
 * It does not invoke a deployment or mutate any Firebase resource.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const root = "/usr/local/lib/node_modules/firebase-tools/lib";
const auth = require(`${root}/auth`);
const { requireAuth } = require(`${root}/requireAuth`);
const { Client } = require(`${root}/apiv2`);
const api = require(`${root}/api`);

const project = "eleven11-aristos";
// Keep downloaded production source outside the Git worktree. A caller can
// provide a different approved archive directory as the first argument.
const output = path.resolve(process.argv[2] || "/Users/aristos/Documents/.eleven11-cutover-archives/live-functions");

function writePrivateFile(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("No Firebase CLI account is available");
  const options = { project, projectId: project, user: account.user, tokens: account.tokens, nonInteractive: true };
  await requireAuth(options);
  const functions = new Client({ urlPrefix: api.functionsOrigin(), apiVersion: "v1", auth: true });
  const response = await functions.get(`/projects/${project}/locations/us-central1/functions`);
  const deployed = (response.body.functions || []).sort((a, b) => a.name.localeCompare(b.name));
  const sourceUrls = [...new Set(deployed.map((fn) => fn.sourceUploadUrl).filter(Boolean))];
  if (sourceUrls.length !== 1) throw new Error(`Expected one deployed source bundle, found ${sourceUrls.length}`);
  const source = new URL(sourceUrls[0]);
  if (source.protocol !== "https:" || source.hostname !== "storage.googleapis.com") {
    throw new Error("Refusing an unexpected Functions source URL");
  }
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.chmodSync(output, 0o700);
  const manifest = {
    archivedAt: new Date().toISOString(),
    project,
    functions: deployed.map((fn) => ({
      name: fn.name,
      status: fn.status,
      updateTime: fn.updateTime,
      runtime: fn.runtime,
      region: (fn.name.match(/locations\/([^/]+)/) || [])[1] || null,
    })),
    sourceBundle: null,
    sourceArchiveStatus: "pending download",
  };
  const manifestPath = path.join(output, "functions-manifest.json");
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const storage = new Client({ urlPrefix: source.origin, auth: true });
  const bundle = await storage.get(source.pathname + source.search, { responseType: "stream", resolveOnHTTPError: true });
  if (bundle.status !== 200) {
    manifest.sourceArchiveStatus = `not downloaded (HTTP ${bundle.status}; the operator needs read access to the Gen 1 source-upload object)`;
    writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    throw new Error(`Functions source download failed with HTTP ${bundle.status}`);
  }
  const bundlePath = path.join(output, "functions-gen1-source.zip");
  const temporaryBundlePath = `${bundlePath}.${process.pid}.partial`;
  await pipeline(bundle.body, fs.createWriteStream(temporaryBundlePath, { mode: 0o600 }));
  fs.chmodSync(temporaryBundlePath, 0o600);
  try {
    // This is a ZIP uploaded by Gen 1 Functions, not a gzip stream. Retain it
    // only after its ZIP directory and every entry have been validated.
    execFileSync("unzip", ["-t", temporaryBundlePath], { stdio: "pipe" });
  } catch (error) {
    fs.rmSync(temporaryBundlePath, { force: true });
    throw new Error(`Downloaded Functions source failed ZIP validation: ${error.message}`);
  }
  fs.renameSync(temporaryBundlePath, bundlePath);
  fs.chmodSync(bundlePath, 0o600);
  manifest.sourceBundle = "functions-gen1-source.zip";
  manifest.sourceBundleSha256 = sha256(bundlePath);
  manifest.sourceArchiveStatus = "downloaded";
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({
    output,
    functions: manifest.functions.length,
    sourceBundle: manifest.sourceBundle,
    sourceBundleSha256: manifest.sourceBundleSha256,
  }, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
