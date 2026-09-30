const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../functions/node_modules/typescript");

const values = new Map();
const files = new Set();
const AsyncStorage = {
  multiGet: async (keys) => keys.map((key) => [key, values.get(key) ?? null]),
  setItem: async (key, value) => values.set(key, value),
  removeItem: async (key) => values.delete(key),
};
const FileSystem = {
  documentDirectory: "file://documents/",
  getInfoAsync: async (uri) => ({ exists: files.has(uri) }),
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ from, to }) => { if (!files.has(from)) throw new Error("missing source"); files.add(to); },
  deleteAsync: async (uri) => files.delete(uri),
};
const source = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/lib/drafts.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const moduleExports = {};
new Function("require", "exports", compiled.outputText)((name) => {
  if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (name === "expo-file-system/legacy") return FileSystem;
  throw new Error(`Unexpected module ${name}`);
}, moduleExports);

test("drafts restore durable photos and a stale save cannot restore a cleared draft", async () => {
  files.add("file://picker/photo.jpg");
  const uid = "draft-owner";
  const copied = await moduleExports.copyDraftPhoto(uid, "file://picker/photo.jpg");
  const savedAt = Date.now() - 10;
  await moduleExports.saveDraft(uid, { caption: "Keep this", visibility: "private", photo: { uri: copied }, updatedAt: savedAt });
  assert.deepEqual(await moduleExports.loadDraft(uid), { caption: "Keep this", visibility: "private", photo: { uri: copied }, updatedAt: savedAt });
  await moduleExports.clearDraft(uid, { uri: copied });
  await moduleExports.saveDraft(uid, { caption: "stale", visibility: "shared", photo: null, updatedAt: savedAt });
  assert.equal(await moduleExports.loadDraft(uid), null);
  assert.equal(files.has(copied), false);
});
