const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { DateTime } = require('../functions/node_modules/luxon');
const stored = new Map();
let queue = Promise.resolve();
let sequence = 0;
const collection = (name) => ({
  doc: (id = `post-${++sequence}`) => ({ id, key: `${name}/${id}` }),
  where() { return this; },
  limit() { return this; },
});
const db = {
  collection,
  runTransaction(callback) {
    const operation = queue.then(() => callback({
      get: async (ref) => ref.key ? { exists: stored.has(ref.key) } : { empty: true },
      create: (ref, data) => stored.set(ref.key, data),
    }));
    queue = operation.catch(() => {});
    return operation;
  },
};
// Exercise the actual callable with a serialized in-memory transaction adapter.
// Firebase emulator/device checks are still needed for service integration.
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'firebase-admin/firestore') {
    return { getFirestore: () => db, FieldValue: { serverTimestamp: () => 'server-time' } };
  }
  return originalLoad.call(this, name, ...args);
};
const { submitPost } = require('../functions/lib/index');
Module._load = originalLoad;
const payload = { tzId: 'UTC', caption: ' A wish ', media: { type: 'none' } };
const auth = { auth: { uid: 'test-user' } };

test('callable enforces authentication, payload validation, window and concurrent duplicates', async () => {
  const originalNow = DateTime.now;
  try {
    DateTime.now = () => DateTime.fromISO('2026-09-23T11:11:30Z');
    await assert.rejects(submitPost.run(payload, {}), { code: 'unauthenticated' });
    await assert.rejects(submitPost.run({ ...payload, caption: '   ' }, auth), { code: 'invalid-argument' });
    await assert.rejects(submitPost.run({ ...payload, tzId: 'bad-zone' }, auth), { code: 'invalid-argument' });
    DateTime.now = () => DateTime.fromISO('2026-09-23T11:12:30Z');
    await assert.rejects(submitPost.run(payload, auth), { code: 'failed-precondition' });
    DateTime.now = () => DateTime.fromISO('2026-09-23T23:11:30Z');
    const results = await Promise.allSettled([submitPost.run(payload, auth), submitPost.run(payload, auth)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'already-exists');
    const posts = [...stored.entries()].filter(([key]) => key.startsWith('posts/'));
    assert.equal(posts.length, 1);
    assert.equal(posts[0][1].caption, 'A wish');
  } finally {
    DateTime.now = originalNow;
  }
});
