const assert = require("node:assert/strict");

const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || "127.0.0.1";
const project = "eleven11-aristos";
const functionsBase = `http://${host}:5001/${project}/us-central1`;
const authBase = `http://${host}:9099/identitytoolkit.googleapis.com/v1`;
// Match the app's configured default bucket so the emulator loads the same
// Storage Rules target used by the client.
const emulatorBucket = "eleven11-aristos.firebasestorage.app";

const json = async (response) => {
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
};

async function newIdentity() {
  const response = await fetch(`${authBase}/accounts:signUp?key=emulator`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const result = await json(response);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function call(name, token, data) {
  const response = await fetch(`${functionsBase}/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
  return json(response);
}

async function main() {
  const realStart = Date.now();
  const now = Date.parse(process.env.ELEVEN11_EMULATOR_NOW || "");
  const windowStart = Date.parse(process.env.ELEVEN11_EMULATOR_WINDOW_START || "");
  assert(Number.isFinite(now) && Number.isFinite(windowStart), "Set emulator clock variables");

  const first = await newIdentity();
  const clock = await call("getServerTime", first.idToken, {});
  assert.equal(clock.status, 200, JSON.stringify(clock.body));
  const expectedNow = now + (Date.now() - realStart);
  console.log(JSON.stringify({ emulatorClock: clock.body.result.serverMillis, expectedNow }));
  assert(Math.abs(clock.body.result.serverMillis - expectedNow) < 60000);

  const missingAuth = await fetch(`${functionsBase}/canPost`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { tzId: "America/Toronto", clientNow: 0 } }),
  }).then(json);
  assert.equal(missingAuth.status, 401, JSON.stringify(missingAuth.body));

  // Leave a small startup margin: the Functions worker captures its real-time
  // anchor when it first loads, shortly after this script starts.
  const waitMs = Math.max(0, windowStart - (now + (Date.now() - realStart)) + 5000);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const textPayload = {
    tzId: "America/Toronto",
    caption: "emulator text smoke",
    media: { type: "none" },
  };
  const text = await call("submitPost", first.idToken, textPayload);
  assert.equal(text.status, 200, JSON.stringify(text.body));
  const textDuplicate = await call("submitPost", first.idToken, textPayload);
  assert.equal(textDuplicate.status, 409, JSON.stringify(textDuplicate.body));
  assert.equal(textDuplicate.body.error.status, "ALREADY_EXISTS");

  const { initializeApp } = require("../apps/mobile/node_modules/firebase/app");
  const { getAuth, connectAuthEmulator, signInAnonymously } = require("../apps/mobile/node_modules/firebase/auth");
  const { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, deleteObject } = require("../apps/mobile/node_modules/firebase/storage");
  const { getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, terminate, where } = require("../apps/mobile/node_modules/firebase/firestore");
  const clientApp = initializeApp({ projectId: project, storageBucket: emulatorBucket, apiKey: "emulator" }, "storage-smoke");
  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${host}:9099`, { disableWarnings: true });
  await signInAnonymously(clientAuth);
  const second = { localId: clientAuth.currentUser.uid, idToken: await clientAuth.currentUser.getIdToken() };
  const objectPath = `uploads/${second.localId}/emulator.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const clientStorage = getStorage(clientApp);
  connectStorageEmulator(clientStorage, host, 9199);
  const uploaded = await uploadBytes(ref(clientStorage, objectPath), png, { contentType: "image/png" });
  const uploadUrl = await getDownloadURL(uploaded.ref);

  const attackerApp = initializeApp({ projectId: project, storageBucket: emulatorBucket, apiKey: "emulator" }, "storage-attacker");
  const attackerAuth = getAuth(attackerApp);
  connectAuthEmulator(attackerAuth, `http://${host}:9099`, { disableWarnings: true });
  await signInAnonymously(attackerAuth);
  const attackerStorage = getStorage(attackerApp);
  connectStorageEmulator(attackerStorage, host, 9199);
  await assert.rejects(
    uploadBytes(ref(attackerStorage, objectPath), png, { contentType: "image/png" }),
    { code: "storage/unauthorized" },
  );
  await deleteObject(uploaded.ref);
  const feedPhotoRef = ref(clientStorage, `uploads/${second.localId}/feed-photo.png`);
  await uploadBytes(feedPhotoRef, png, { contentType: "image/png" });
  const media = await getDownloadURL(feedPhotoRef);
  const photoPayload = {
    tzId: "America/Toronto",
    caption: "emulator photo smoke",
    media: { type: "image", url: media, w: 1, h: 1 },
  };
  const photo = await call("submitPost", second.idToken, photoPayload);
  assert.equal(photo.status, 200, JSON.stringify(photo.body));
  const photoDuplicate = await call("submitPost", second.idToken, photoPayload);
  assert.equal(photoDuplicate.status, 409, JSON.stringify(photoDuplicate.body));
  assert.equal(photoDuplicate.body.error.status, "ALREADY_EXISTS");

  const extraPostIds = [];
  for (let index = 0; index < 5; index += 1) {
    const identity = await newIdentity();
    const post = await call("submitPost", identity.idToken, {
      tzId: "America/Toronto",
      caption: `feed pagination ${index}`,
      media: { type: "none" },
    });
    assert.equal(post.status, 200, JSON.stringify(post.body));
    extraPostIds.push(post.body.result.postId);
  }

  const { initializeApp: initializeAdminApp, getApps: getAdminApps } = require("../functions/node_modules/firebase-admin/lib/app");
  const { getFirestore: getAdminFirestore } = require("../functions/node_modules/firebase-admin/lib/firestore");
  if (!getAdminApps().length) initializeAdminApp({ projectId: project });
  const adminDb = getAdminFirestore();
  await adminDb.collection("posts").doc(extraPostIds[0]).update({ status: "hidden" });
  const photoDoc = await adminDb.collection("posts").doc(photo.body.result.postId).get();
  const feedStart = new Date(photoDoc.data().createdAt.toMillis());
  const feedEnd = new Date(feedStart);
  feedStart.setUTCHours(0, 0, 0, 0);
  feedEnd.setUTCDate(feedEnd.getUTCDate() + 1);

  const feedDb = getFirestore(clientApp);
  connectFirestoreEmulator(feedDb, host, 8080);
  const feedBase = query(
    collection(feedDb, "posts"),
    where("status", "==", "active"),
    where("createdAt", ">=", feedStart),
    where("createdAt", "<", feedEnd),
    orderBy("createdAt", "desc"),
  );
  const firstPage = await getDocs(query(feedBase, limit(3)));
  const secondPage = await getDocs(query(feedBase, startAfter(firstPage.docs[firstPage.docs.length - 1]), limit(3)));
  assert.equal(firstPage.docs.length, 3);
  assert.equal(secondPage.docs.length, 3);
  const pagedIds = [...firstPage.docs, ...secondPage.docs].map((entry) => entry.id);
  assert(!pagedIds.includes(extraPostIds[0]), "Hidden posts must not appear in the feed");
  assert(pagedIds.includes(photo.body.result.postId), "Photo posts must appear in the feed");
  await assert.rejects(getDoc(doc(feedDb, "posts", extraPostIds[0])), { code: "permission-denied" });
  await terminate(feedDb);

  console.log(JSON.stringify({
    clockMillis: clock.body.result.serverMillis,
    textPostId: text.body.result.postId,
    photoPostId: photo.body.result.postId,
    duplicateStatuses: [textDuplicate.status, photoDuplicate.status],
    storageRuleChecks: { ownerUpload: true, crossUserUploadRejected: true, ownerDelete: true },
    feedChecks: { pagination: true, hiddenPostExcluded: true, hiddenPostReadRejected: true },
  }));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
