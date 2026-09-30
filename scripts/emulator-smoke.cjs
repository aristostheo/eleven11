const assert = require("node:assert/strict");
const { DateTime } = require("../functions/node_modules/luxon");

const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || "127.0.0.1";
const project = "eleven11-aristos";
const bucket = "eleven11-aristos.firebasestorage.app";
const functionsPort = process.env.ELEVEN11_FUNCTIONS_EMULATOR_PORT || "5001";
const authPort = process.env.ELEVEN11_AUTH_EMULATOR_PORT || "9099";
const firestorePort = process.env.ELEVEN11_FIRESTORE_EMULATOR_PORT || "8080";
const storagePort = process.env.ELEVEN11_STORAGE_EMULATOR_PORT || "9199";
const functionsBase = `http://${host}:${functionsPort}/${project}/us-central1`;

const json = async (response) => {
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
};

async function call(name, token, data) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${functionsBase}/${name}`, {
    method: "POST", headers, body: JSON.stringify({ data }),
  });
  return json(response);
}

async function main() {
  const realStart = Date.now();
  const now = Date.parse(process.env.ELEVEN11_EMULATOR_NOW || "");
  const windowStart = Date.parse(process.env.ELEVEN11_EMULATOR_WINDOW_START || "");
  assert(Number.isFinite(now) && Number.isFinite(windowStart), "Set emulator clock variables");

  const { initializeApp } = require("../apps/mobile/node_modules/firebase/app");
  const { getAuth, connectAuthEmulator, signInAnonymously } = require("../apps/mobile/node_modules/firebase/auth");
  const { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, deleteObject } = require("../apps/mobile/node_modules/firebase/storage");
  const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require("../apps/mobile/node_modules/firebase/firestore");

  async function identity(name) {
    const app = initializeApp({ projectId: project, storageBucket: bucket, apiKey: "emulator" }, name);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    await signInAnonymously(auth);
    const user = auth.currentUser;
    const storage = getStorage(app);
    connectStorageEmulator(storage, host, Number(storagePort));
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, host, Number(firestorePort));
    return { app, user, token: await user.getIdToken(), storage, firestore };
  }

  const first = await identity("journal-owner");
  const second = await identity("journal-other");
  const clock = await call("getServerTime", first.token, {});
  assert.equal(clock.status, 200, JSON.stringify(clock.body));
  assert(Math.abs(clock.body.result.serverMillis - (now + Date.now() - realStart)) < 60000);
  const missingAuth = await call("canPost", null, { tzId: "America/Toronto" });
  assert.equal(missingAuth.status, 401, JSON.stringify(missingAuth.body));

  const waitMs = Math.max(0, windowStart - (now + Date.now() - realStart) + 2000);
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const privatePath = `uploads/${first.user.uid}/private.png`;
  await uploadBytes(ref(first.storage, privatePath), png, {
    contentType: "image/png",
    customMetadata: { ownerUid: first.user.uid, visibility: "pending" },
  });

  const privatePost = await call("submitPost", first.token, {
    tzId: "America/Toronto", caption: "private image", visibility: "private",
    media: { type: "image", storagePath: privatePath, w: 1, h: 1 },
  });
  assert.equal(privatePost.status, 200, JSON.stringify(privatePost.body));
  const duplicateAcrossVisibility = await call("submitPost", first.token, {
    tzId: "America/Toronto", caption: "should be rejected", visibility: "shared", media: { type: "none" },
  });
  assert.equal(duplicateAcrossVisibility.status, 409, JSON.stringify(duplicateAcrossVisibility.body));

  const sharedPath = `uploads/${second.user.uid}/shared.png`;
  await uploadBytes(ref(second.storage, sharedPath), png, {
    contentType: "image/png",
    customMetadata: { ownerUid: second.user.uid, visibility: "pending" },
  });
  const sharedPost = await call("submitPost", second.token, {
    tzId: "America/Toronto", caption: "shared image", visibility: "shared",
    media: { type: "image", storagePath: sharedPath, w: 1, h: 1 },
  });
  assert.equal(sharedPost.status, 200, JSON.stringify(sharedPost.body));

  // Owner can read private data; another identity cannot read its document,
  // get an image URL, or retrieve private image bytes through the callable.
  await getDoc(doc(first.firestore, "posts", privatePost.body.result.postId));
  await assert.rejects(getDoc(doc(second.firestore, "posts", privatePost.body.result.postId)), { code: "permission-denied" });
  const ownerImage = await call("getPrivateImage", first.token, { storagePath: privatePath });
  assert.equal(ownerImage.status, 200, JSON.stringify(ownerImage.body));
  assert(ownerImage.body.result.dataUrl.startsWith("data:image/png;base64,"));
  const otherImage = await call("getPrivateImage", second.token, { storagePath: privatePath });
  assert.equal(otherImage.status, 403, JSON.stringify(otherImage.body));
  await assert.rejects(getDownloadURL(ref(second.storage, privatePath)), { code: "storage/unauthorized" });
  assert((await getDownloadURL(ref(second.storage, sharedPath))).includes("shared.png"));

  const { initializeApp: initializeAdminApp, getApps } = require("../functions/node_modules/firebase-admin/lib/app");
  const { getFirestore: getAdminFirestore, Timestamp } = require("../functions/node_modules/firebase-admin/lib/firestore");
  if (!getApps().length) initializeAdminApp({ projectId: project, storageBucket: bucket });
  const adminDb = getAdminFirestore();
  const createdAt = Timestamp.fromMillis(now + (Date.now() - realStart));
  await adminDb.collection("posts").doc("older-owner").set({
    uid: first.user.uid, createdAt: Timestamp.fromMillis(createdAt.toMillis() - 86400000), dayKey: "older",
    caption: "older private wish", visibility: "private", media: { type: "none" }, status: "active",
  });
  for (let index = 0; index < 11; index += 1) {
    await adminDb.collection("posts").doc(`shared-page-${index}`).set({
      uid: `seed-${index}`, createdAt: Timestamp.fromMillis(createdAt.toMillis() - index - 10), dayKey: "seed",
      caption: `shared page ${index}`, visibility: "shared", media: { type: "none" }, status: "active",
    });
  }

  const history = await call("getMyWishes", first.token, {});
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(history.body.result.wishes.length, 2);
  assert(history.body.result.wishes.every((wish) => wish.visibility === "private"));
  const otherHistory = await call("getMyWishes", second.token, {});
  assert.equal(otherHistory.status, 200, JSON.stringify(otherHistory.body));
  assert.equal(otherHistory.body.result.wishes.length, 1);

  const firstFeed = await call("getDailyWishes", null, { tzId: "America/Toronto" });
  assert.equal(firstFeed.status, 200, JSON.stringify(firstFeed.body));
  assert.equal(firstFeed.body.result.wishes.length, 10);
  const secondFeed = await call("getDailyWishes", null, { tzId: "America/Toronto", cursor: firstFeed.body.result.cursor });
  assert.equal(secondFeed.status, 200, JSON.stringify(secondFeed.body));
  assert(secondFeed.body.result.wishes.length >= 1);
  const feedWishes = [...firstFeed.body.result.wishes, ...secondFeed.body.result.wishes];
  assert(feedWishes.some((wish) => wish.id === sharedPost.body.result.postId));
  assert(!feedWishes.some((wish) => wish.id === privatePost.body.result.postId));
  assert(feedWishes.every((wish) => !("uid" in wish)));

  const temporaryPath = `uploads/${first.user.uid}/temporary.png`;
  await uploadBytes(ref(first.storage, temporaryPath), png, {
    contentType: "image/png",
    customMetadata: { ownerUid: first.user.uid, visibility: "pending" },
  });
  await deleteObject(ref(first.storage, temporaryPath));
  console.log(JSON.stringify({
    privatePostId: privatePost.body.result.postId,
    sharedPostId: sharedPost.body.result.postId,
    privacy: { ownerPrivateRead: true, otherPrivateRejected: true, noPrivateTokenUrl: true },
    feed: { sharedAnonymous: true, privateExcluded: true, pagination: true },
    history: { ownerOlderWish: true, otherIsolated: true },
    duplicateAcrossVisibility: duplicateAcrossVisibility.status,
  }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
