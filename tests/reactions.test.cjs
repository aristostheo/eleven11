const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const stored = new Map();
let queue = Promise.resolve();
const ref = (key) => ({
  key,
  id: key.split("/").at(-1),
  collection: (name) => ({ doc: (id) => ref(`${key}/${name}/${id}`) }),
});
const db = {
  collection: (name) => ({
    doc: (id) => ref(`${name}/${id}`),
    where() { return this; },
    limit() { return this; },
  }),
  runTransaction(callback) {
    const operation = queue.then(() => callback({
      get: async (document) => ({
        exists: stored.has(document.key),
        data: () => stored.get(document.key),
      }),
      create: (document, data) => stored.set(document.key, data),
      delete: (document) => stored.delete(document.key),
      update: (document, data) => {
        const current = stored.get(document.key);
        stored.set(document.key, {
          ...current,
          reacts: { ...current.reacts, sparkle: data["reacts.sparkle"] },
        });
      },
    }));
    queue = operation.catch(() => {});
    return operation;
  },
};

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "firebase-admin/firestore") {
    return { getFirestore: () => db, FieldValue: { serverTimestamp: () => "server-time" } };
  }
  return originalLoad.call(this, name, ...args);
};
const { toggleSparkleReaction } = require("../functions/lib/index");
Module._load = originalLoad;

const caller = (uid) => ({ auth: { uid } });
const activeShared = (id) => stored.set(`posts/${id}`, {
  status: "active", visibility: "shared", reacts: { sparkle: 0 },
});

test("sparkle reactions atomically toggle once per identity and keep counts consistent", async () => {
  activeShared("shared");
  const [first, second] = await Promise.all([
    toggleSparkleReaction.run({ postId: "shared" }, caller("first")),
    toggleSparkleReaction.run({ postId: "shared" }, caller("second")),
  ]);
  assert.equal(first.reacted, true);
  assert.equal(second.reacted, true);
  assert.equal(stored.get("posts/shared").reacts.sparkle, 2);

  const removed = await toggleSparkleReaction.run({ postId: "shared" }, caller("first"));
  assert.deepEqual(removed, { postId: "shared", reacted: false, count: 1 });
  const restored = await toggleSparkleReaction.run({ postId: "shared" }, caller("first"));
  assert.deepEqual(restored, { postId: "shared", reacted: true, count: 2 });
  assert.equal(stored.get("posts/shared").reacts.sparkle, 2);
});

test("sparkles reject invalid, missing, private, and hidden wishes", async () => {
  stored.set("posts/private", { status: "active", visibility: "private", reacts: { sparkle: 0 } });
  stored.set("posts/hidden", { status: "hidden", visibility: "shared", reacts: { sparkle: 0 } });
  await assert.rejects(toggleSparkleReaction.run({ postId: "bad/id" }, caller("first")), { code: "invalid-argument" });
  await assert.rejects(toggleSparkleReaction.run({ postId: "missing" }, caller("first")), { code: "not-found" });
  await assert.rejects(toggleSparkleReaction.run({ postId: "private" }, caller("first")), { code: "permission-denied" });
  await assert.rejects(toggleSparkleReaction.run({ postId: "hidden" }, caller("first")), { code: "permission-denied" });
  await assert.rejects(toggleSparkleReaction.run({ postId: "shared" }, {}), { code: "unauthenticated" });
});
