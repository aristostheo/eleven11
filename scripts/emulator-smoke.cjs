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
  const { getAuth, connectAuthEmulator, signInAnonymously, linkWithCredential, EmailAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword } = require("../apps/mobile/node_modules/firebase/auth");
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
    return { app, auth, user, token: await user.getIdToken(), storage, firestore };
  }

  const first = await identity("journal-owner");
  const second = await identity("journal-other");
  const moderator = await identity("journal-moderator");
  for (const identityToInitialize of [first, second, moderator]) {
    const profile = await call("initializePostingProfile", identityToInitialize.token, { deviceTimezone: "America/Toronto" });
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    assert.equal(profile.body.result.timezone, "America/Toronto");
  }
  const clock = await call("getServerTime", first.token, {});
  assert.equal(clock.status, 200, JSON.stringify(clock.body));
  assert(Math.abs(clock.body.result.serverMillis - (now + Date.now() - realStart)) < 60000);
  const missingAuth = await call("canPost", null, {});
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
    caption: "private image", visibility: "private",
    media: { type: "image", storagePath: privatePath, w: 1, h: 1 },
  });
  assert.equal(privatePost.status, 200, JSON.stringify(privatePost.body));
  const duplicateAcrossVisibility = await call("submitPost", first.token, {
    caption: "should be rejected", visibility: "shared", media: { type: "none" },
  });
  assert.equal(duplicateAcrossVisibility.status, 409, JSON.stringify(duplicateAcrossVisibility.body));

  const sharedPath = `uploads/${second.user.uid}/shared.png`;
  await uploadBytes(ref(second.storage, sharedPath), png, {
    contentType: "image/png",
    customMetadata: { ownerUid: second.user.uid, visibility: "pending" },
  });
  const sharedPost = await call("submitPost", second.token, {
    caption: "shared image", visibility: "shared",
    media: { type: "image", storagePath: sharedPath, w: 1, h: 1 },
  });
  assert.equal(sharedPost.status, 200, JSON.stringify(sharedPost.body));
  const sharedImage = await call("getSharedImage", first.token, { postId: sharedPost.body.result.postId });
  assert.equal(sharedImage.status, 200, JSON.stringify(sharedImage.body));

  // Reactions are callable-only, independent of the posting window. A viewer
  // can toggle exactly one sparkle, and both identities update the count safely.
  const firstReaction = await call("toggleSparkleReaction", first.token, { postId: sharedPost.body.result.postId });
  assert.equal(firstReaction.status, 200, JSON.stringify(firstReaction.body));
  assert.deepEqual(firstReaction.body.result, { postId: sharedPost.body.result.postId, reacted: true, count: 1 });
  const firstRemoval = await call("toggleSparkleReaction", first.token, { postId: sharedPost.body.result.postId });
  assert.equal(firstRemoval.status, 200, JSON.stringify(firstRemoval.body));
  assert.equal(firstRemoval.body.result.reacted, false);
  const [firstAgain, secondReaction] = await Promise.all([
    call("toggleSparkleReaction", first.token, { postId: sharedPost.body.result.postId }),
    call("toggleSparkleReaction", second.token, { postId: sharedPost.body.result.postId }),
  ]);
  assert.equal(firstAgain.status, 200, JSON.stringify(firstAgain.body));
  assert.equal(secondReaction.status, 200, JSON.stringify(secondReaction.body));
  assert.deepEqual([firstAgain.body.result.count, secondReaction.body.result.count].sort(), [1, 2]);

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
  await assert.rejects(
    getDoc(doc(first.firestore, "posts", sharedPost.body.result.postId, "reactions", first.user.uid)),
    { code: "permission-denied" }
  );

  const { initializeApp: initializeAdminApp, getApps } = require("../functions/node_modules/firebase-admin/lib/app");
  const { getFirestore: getAdminFirestore, Timestamp } = require("../functions/node_modules/firebase-admin/lib/firestore");
  const { getAuth: getAdminAuth } = require("../functions/node_modules/firebase-admin/lib/auth");
  if (!getApps().length) initializeAdminApp({ projectId: project, storageBucket: bucket });
  const adminDb = getAdminFirestore();
  await getAdminAuth().setCustomUserClaims(moderator.user.uid, { admin: true });
  const moderatorToken = await moderator.user.getIdToken(true);
  const arbitraryTimezone = await call("canPost", first.token, { tzId: "Pacific/Auckland" });
  assert.equal(arbitraryTimezone.status, 400, JSON.stringify(arbitraryTimezone.body));
  const timezoneAfterPost = await call("updatePostingTimezone", first.token, { timezone: "Pacific/Auckland" });
  assert.equal(timezoneAfterPost.status, 400, JSON.stringify(timezoneAfterPost.body));
  const storedTimezone = await call("getPostingProfile", first.token, {});
  assert.equal(storedTimezone.status, 200, JSON.stringify(storedTimezone.body));
  assert.equal(storedTimezone.body.result.timezone, "America/Toronto");
  const traveler = await identity("timezone-traveler");
  const travelerProfile = await call("initializePostingProfile", traveler.token, { deviceTimezone: "America/Toronto" });
  assert.equal(travelerProfile.status, 200, JSON.stringify(travelerProfile.body));
  await adminDb.collection("users").doc(traveler.user.uid).update({ timezoneUpdatedAt: Timestamp.fromMillis(now - 8 * 86400000) });
  const traveled = await call("updatePostingTimezone", traveler.token, { timezone: "Pacific/Auckland" });
  assert.equal(traveled.status, 200, JSON.stringify(traveled.body));
  assert.equal(traveled.body.result.timezone, "Pacific/Auckland");
  const refreshedTravelerProfile = await call("initializePostingProfile", traveler.token, { deviceTimezone: "America/Toronto" });
  assert.equal(refreshedTravelerProfile.status, 200, JSON.stringify(refreshedTravelerProfile.body));
  assert.equal(refreshedTravelerProfile.body.result.timezone, "Pacific/Auckland");
  const repeatedTravel = await call("updatePostingTimezone", traveler.token, { timezone: "Asia/Tokyo" });
  assert.equal(repeatedTravel.status, 400, JSON.stringify(repeatedTravel.body));

  // Linking preserves the post-owning anonymous UID. A failed sign-in leaves a
  // wish-owning anonymous session in place; a later deliberate successful
  // sign-in changes identities without merging their wishes.
  const originalOwnerUid = first.user.uid;
  await linkWithCredential(first.user, EmailAuthProvider.credential("owner@example.test", "secret1"));
  assert.equal(first.user.uid, originalOwnerUid);
  first.token = await first.user.getIdToken(true);
  const linkedHistory = await call("getMyWishes", first.token, {});
  assert.equal(linkedHistory.status, 200, JSON.stringify(linkedHistory.body));
  assert(linkedHistory.body.result.wishes.some((wish) => wish.id === privatePost.body.result.postId));
  await sendPasswordResetEmail(first.auth, "owner@example.test");
  const unrelated = await identity("unrelated-saved-account");
  await linkWithCredential(unrelated.user, EmailAuthProvider.credential("other@example.test", "secret2"));
  const protectedSession = await identity("protected-anonymous-session");
  const protectedUid = protectedSession.user.uid;
  await adminDb.collection("posts").doc("protected-anonymous-wish").set({
    uid: protectedUid, createdAt: Timestamp.fromMillis(now), dayKey: "protected",
    caption: "do not replace on invalid sign-in", visibility: "private", media: { type: "none" }, status: "active",
  });
  const protectedStatus = await call("getIdentityStatus", protectedSession.token, {});
  assert.equal(protectedStatus.status, 200, JSON.stringify(protectedStatus.body));
  assert.equal(protectedStatus.body.result.hasWishes, true);
  await assert.rejects(
    signInWithEmailAndPassword(protectedSession.auth, "other@example.test", "wrong-password"),
    (error) => error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password",
  );
  assert.equal(protectedSession.auth.currentUser.uid, protectedUid);
  const protectedToken = await protectedSession.auth.currentUser.getIdToken();
  const protectedHistory = await call("getMyWishes", protectedToken, {});
  assert.equal(protectedHistory.status, 200, JSON.stringify(protectedHistory.body));
  assert(protectedHistory.body.result.wishes.some((wish) => wish.id === "protected-anonymous-wish"));
  const signedInUnrelated = await signInWithEmailAndPassword(protectedSession.auth, "other@example.test", "secret2");
  assert.equal(signedInUnrelated.user.uid, unrelated.user.uid);
  assert.notEqual(signedInUnrelated.user.uid, protectedUid);

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

  const emptyReview = await call("getModerationReports", moderatorToken, {});
  assert.equal(emptyReview.status, 200, JSON.stringify(emptyReview.body));
  assert.deepEqual(emptyReview.body.result.reports, []);

  const unauthenticatedReport = await call("reportWish", null, { postId: sharedPost.body.result.postId, reason: "spam" });
  assert.equal(unauthenticatedReport.status, 401, JSON.stringify(unauthenticatedReport.body));
  const privateReport = await call("reportWish", second.token, { postId: privatePost.body.result.postId, reason: "spam" });
  assert.equal(privateReport.status, 403, JSON.stringify(privateReport.body));
  const missingReport = await call("reportWish", first.token, { postId: "missing-wish", reason: "spam" });
  assert.equal(missingReport.status, 404, JSON.stringify(missingReport.body));
  const invalidReport = await call("reportWish", first.token, { postId: sharedPost.body.result.postId, reason: "invalid" });
  assert.equal(invalidReport.status, 400, JSON.stringify(invalidReport.body));
  const firstReport = await call("reportWish", first.token, {
    postId: sharedPost.body.result.postId, reason: "spam", details: "Test report",
  });
  assert.equal(firstReport.status, 200, JSON.stringify(firstReport.body));
  const duplicateReport = await call("reportWish", first.token, { postId: sharedPost.body.result.postId, reason: "spam" });
  assert.equal(duplicateReport.status, 409, JSON.stringify(duplicateReport.body));
  const secondReport = await call("reportWish", second.token, { postId: sharedPost.body.result.postId, reason: "abuse" });
  assert.equal(secondReport.status, 200, JSON.stringify(secondReport.body));
  const regularReview = await call("getModerationReports", first.token, {});
  assert.equal(regularReview.status, 403, JSON.stringify(regularReview.body));
  const review = await call("getModerationReports", moderatorToken, {});
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.result.reports.length, 2);
  assert(review.body.result.reports.every((report) => !("reporterUid" in report)));
  const dismissed = await call("decideModerationReport", moderatorToken, {
    reportId: review.body.result.reports.find((report) => report.reason === "spam").id, action: "dismiss",
  });
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
  const nonAdminDecision = await call("decideModerationReport", first.token, {
    reportId: review.body.result.reports.find((report) => report.reason === "abuse").id, action: "hide",
  });
  assert.equal(nonAdminDecision.status, 403, JSON.stringify(nonAdminDecision.body));
  const imageAfterDismissal = await call("getSharedImage", first.token, { postId: sharedPost.body.result.postId });
  assert.equal(imageAfterDismissal.status, 200, JSON.stringify(imageAfterDismissal.body));
  // A bad path makes the actual Storage metadata update fail after the
  // Firestore hide. The report must remain admin-visible for a later repair.
  await adminDb.collection("posts").doc(sharedPost.body.result.postId).update({ "media.storagePath": `${sharedPath}.missing` });
  const failedHide = await call("decideModerationReport", moderatorToken, {
    reportId: review.body.result.reports.find((report) => report.reason === "abuse").id, action: "hide",
  });
  assert.equal(failedHide.status, 200, JSON.stringify(failedHide.body));
  assert.equal(failedHide.body.result.mediaRevocation, "failed");
  const hiddenSharedImage = await call("getSharedImage", first.token, { postId: sharedPost.body.result.postId });
  assert.equal(hiddenSharedImage.status, 403, JSON.stringify(hiddenSharedImage.body));
  assert((await getDownloadURL(ref(first.storage, sharedPath))).includes("shared.png"));
  await assert.rejects(getDoc(doc(first.firestore, "posts", sharedPost.body.result.postId)), { code: "permission-denied" });
  await assert.rejects(getDoc(doc(second.firestore, "posts", sharedPost.body.result.postId)), { code: "permission-denied" });
  const repairReview = await call("getModerationReports", moderatorToken, {});
  assert.equal(repairReview.status, 200, JSON.stringify(repairReview.body));
  assert.equal(repairReview.body.result.reports.length, 1);
  assert.equal(repairReview.body.result.reports[0].needsImageRepair, true);
  await adminDb.collection("posts").doc(sharedPost.body.result.postId).update({ "media.storagePath": sharedPath });
  const repairedHide = await call("decideModerationReport", moderatorToken, {
    reportId: repairReview.body.result.reports[0].id, action: "hide",
  });
  assert.equal(repairedHide.status, 200, JSON.stringify(repairedHide.body));
  assert.equal(repairedHide.body.result.mediaRevocation, "complete");
  await assert.rejects(getDownloadURL(ref(first.storage, sharedPath)), { code: "storage/unauthorized" });
  const emptyAfterRepair = await call("getModerationReports", moderatorToken, {});
  assert.equal(emptyAfterRepair.status, 200, JSON.stringify(emptyAfterRepair.body));
  assert.deepEqual(emptyAfterRepair.body.result.reports, []);

  for (let index = 0; index < 4; index += 1) {
    const rateReport = await call("reportWish", first.token, { postId: `shared-page-${index}`, reason: "other" });
    assert.equal(rateReport.status, 200, JSON.stringify(rateReport.body));
  }
  const rateLimitedReport = await call("reportWish", first.token, { postId: "shared-page-4", reason: "other" });
  assert.equal(rateLimitedReport.status, 429, JSON.stringify(rateLimitedReport.body));
  await adminDb.collection("posts").doc("hidden-wish").set({
    uid: "hidden-owner", createdAt, dayKey: "seed", caption: "hidden", visibility: "shared",
    media: { type: "none" }, status: "hidden", reacts: { sparkle: 0 },
  });
  const privateReaction = await call("toggleSparkleReaction", second.token, { postId: privatePost.body.result.postId });
  assert.equal(privateReaction.status, 403, JSON.stringify(privateReaction.body));
  const hiddenReaction = await call("toggleSparkleReaction", second.token, { postId: "hidden-wish" });
  assert.equal(hiddenReaction.status, 403, JSON.stringify(hiddenReaction.body));
  const missingReaction = await call("toggleSparkleReaction", second.token, { postId: "missing-wish" });
  assert.equal(missingReaction.status, 404, JSON.stringify(missingReaction.body));
  const invalidReaction = await call("toggleSparkleReaction", second.token, { postId: "bad/id" });
  assert.equal(invalidReaction.status, 400, JSON.stringify(invalidReaction.body));

  const history = await call("getMyWishes", first.token, {});
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(history.body.result.wishes.length, 2);
  assert(history.body.result.wishes.every((wish) => wish.visibility === "private"));
  const otherHistory = await call("getMyWishes", second.token, {});
  assert.equal(otherHistory.status, 200, JSON.stringify(otherHistory.body));
  assert.equal(otherHistory.body.result.wishes.length, 1);
  assert.equal(otherHistory.body.result.wishes[0].status, "hidden");

  const firstFeed = await call("getDailyWishes", first.token, { tzId: "America/Toronto" });
  assert.equal(firstFeed.status, 200, JSON.stringify(firstFeed.body));
  assert.equal(firstFeed.body.result.wishes.length, 10);
  const secondFeed = await call("getDailyWishes", first.token, { tzId: "America/Toronto", cursor: firstFeed.body.result.cursor });
  assert.equal(secondFeed.status, 200, JSON.stringify(secondFeed.body));
  assert(secondFeed.body.result.wishes.length >= 1);
  const feedWishes = [...firstFeed.body.result.wishes, ...secondFeed.body.result.wishes];
  assert(!feedWishes.some((wish) => wish.id === sharedPost.body.result.postId));
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
    reactions: { repeatToggle: true, consistentCount: true, privateAndHiddenRejected: true },
    moderation: { duplicateRejected: true, rateLimited: true, adminOnly: true, hiddenWishExcluded: true, hiddenImageBlocked: true },
    duplicateAcrossVisibility: duplicateAcrossVisibility.status,
  }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
