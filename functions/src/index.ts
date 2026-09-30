/* eslint-disable require-jsdoc, valid-jsdoc */
import * as functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DateTime } from "luxon";
import { z } from "zod";
import { inPostingWindow, mediaSchema, timezoneSchema, visibilitySchema } from "./validation";

initializeApp();
const db = getFirestore();
const storageBucket = process.env.ELEVEN11_STORAGE_BUCKET
  ?? `${process.env.GCLOUD_PROJECT ?? "eleven11-aristos"}.firebasestorage.app`;
const bucket = getStorage().bucket(storageBucket);
const PAGE_SIZE = 10;
const FETCH_SIZE = 25;

// The emulator can run against a deterministic virtual clock. These variables
// are intentionally honored only by the Functions emulator; deployed functions
// always use the real server clock.
const emulatorClockEnabled = process.env.FUNCTIONS_EMULATOR === "true";
const emulatorNowAnchor = emulatorClockEnabled && process.env.ELEVEN11_EMULATOR_NOW
  ? Date.parse(process.env.ELEVEN11_EMULATOR_NOW)
  : NaN;
const emulatorWindowStart = emulatorClockEnabled && process.env.ELEVEN11_EMULATOR_WINDOW_START
  ? Date.parse(process.env.ELEVEN11_EMULATOR_WINDOW_START)
  : NaN;
const emulatorRealAnchor = emulatorClockEnabled && process.env.ELEVEN11_EMULATOR_REAL_START
  ? Number(process.env.ELEVEN11_EMULATOR_REAL_START)
  : Date.now();

const cursorSchema = z.object({
  createdAtMillis: z.number().int().nonnegative(),
  id: z.string().min(1),
}).nullable().optional();
const dailyFeedSchema = z.object({ tzId: timezoneSchema, cursor: cursorSchema });
const historySchema = z.object({ cursor: cursorSchema });
const privateImageSchema = z.object({ storagePath: z.string().regex(/^uploads\/[^/]+\/[^/]+$/) });

type ImageMedia = { type: "image"; storagePath: string; w?: number; h?: number };
type ObjectMetadata = {
  size?: string | number;
  contentType?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Return the real clock, or the advancing emulator clock when configured. */
function serverMillis() {
  return Number.isFinite(emulatorNowAnchor)
    ? emulatorNowAnchor + (Date.now() - emulatorRealAnchor)
    : DateTime.now().toMillis();
}

/** Apply the optional emulator window without changing production behavior. */
function postingWindowFor(now: DateTime) {
  if (Number.isFinite(emulatorWindowStart)) {
    const start = DateTime.fromMillis(emulatorWindowStart).setZone(now.zoneName ?? "UTC");
    const end = start.plus({ seconds: 90 });
    return { start, end, open: now >= start && now < end };
  }
  return { open: inPostingWindow(now) };
}

function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
  return context.auth.uid;
}

function cursorFor(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const createdAt = document.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
  return createdAt ? { createdAtMillis: createdAt.toMillis(), id: document.id } : null;
}

function mediaForDocument(data: FirebaseFirestore.DocumentData) {
  if (data.media?.type !== "image") return { type: "none" as const };
  return {
    type: "image" as const,
    storagePath: data.media.storagePath as string | undefined,
    // Legacy shared posts retain their historic public URL until migrated.
    sharedUrl: data.media.url as string | undefined,
    w: data.media.w as number | undefined,
    h: data.media.h as number | undefined,
  };
}

function visibleFeedWish(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data();
  if (data.visibility === "private") return null;
  const createdAt = data.createdAt as FirebaseFirestore.Timestamp | undefined;
  if (!createdAt) return null;
  // Deliberately do not return uid, dayKey, reports, claims, or other account data.
  return {
    id: document.id,
    caption: data.caption as string,
    createdAtMillis: createdAt.toMillis(),
    media: mediaForDocument(data),
  };
}

function ownedWish(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data();
  const createdAt = data.createdAt as FirebaseFirestore.Timestamp | undefined;
  if (!createdAt) return null;
  return {
    id: document.id,
    caption: data.caption as string,
    createdAtMillis: createdAt.toMillis(),
    visibility: data.visibility === "private" ? "private" : "shared",
    media: mediaForDocument(data),
  };
}

async function verifyOwnedImage(uid: string, media: ImageMedia) {
  if (!media.storagePath.startsWith(`uploads/${uid}/`)) {
    throw new functions.https.HttpsError("permission-denied", "Image does not belong to this account");
  }
  const file = bucket.file(media.storagePath);
  let metadata: ObjectMetadata;
  try {
    [metadata] = await file.getMetadata();
  } catch {
    throw new functions.https.HttpsError("failed-precondition", "Uploaded image was not found");
  }
  if (metadata.metadata?.ownerUid !== uid) {
    throw new functions.https.HttpsError("permission-denied", "Image owner could not be verified");
  }
  if (!metadata.contentType?.startsWith("image/") || Number(metadata.size) >= 3 * 1024 * 1024) {
    throw new functions.https.HttpsError("invalid-argument", "Image does not meet upload requirements");
  }
  return file;
}

async function markImageVisibility(
  file: ReturnType<typeof bucket.file>,
  uid: string,
  visibility: "private" | "shared"
) {
  // Firebase download tokens bypass Storage rules. Remove the token generated
  // at upload time before a private image is referenced by a post.
  await file.setMetadata({
    metadata: {
      ownerUid: uid,
      visibility,
      ...(visibility === "private" ? { firebaseStorageDownloadTokens: null } : {}),
    },
  });
}

// ——— getServerTime ——————————————————————————————————————
export const getServerTime = functions.https.onCall(async () => ({ serverMillis: serverMillis() }));

// ——— canPost ————————————————————————————————————————————
const CanPostSchema = z.object({ tzId: timezoneSchema, clientNow: z.number().optional() });

export const canPost = functions.https.onCall(async (data, context) => {
  const parsed = CanPostSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const uid = requireAuth(context);
  const now = DateTime.fromMillis(serverMillis()).setZone(parsed.data.tzId);
  const dayKey = now.toISODate();
  const existing = await db.collection("posts").where("uid", "==", uid).where("dayKey", "==", dayKey).limit(1).get();
  const inWindow = postingWindowFor(now).open;
  return {
    allowed: inWindow && existing.empty,
    reason: !inWindow ? "outside-window" : existing.empty ? null : "already-posted",
    dayKey,
  };
});

// ——— submitPost —————————————————————————————————————————
const SubmitSchema = z.object({
  tzId: timezoneSchema,
  caption: z.string().trim().min(1).max(280),
  visibility: visibilitySchema,
  media: mediaSchema,
});

export const submitPost = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const { tzId, caption, visibility, media } = parsed.data;
  const now = DateTime.fromMillis(serverMillis()).setZone(tzId);
  const dayKey = now.toISODate();
  if (!postingWindowFor(now).open) {
    throw new functions.https.HttpsError("failed-precondition", "Not in 11:11 window");
  }

  const imageFile = media.type === "image" ? await verifyOwnedImage(uid, media) : null;
  // The visibility is written only by the backend after it verified path and
  // owner metadata. A private object never receives a public download token.
  if (imageFile) await markImageVisibility(imageFile, uid, visibility);

  const claim = db.collection("postClaims").doc(`${uid}_${dayKey}`);
  const ref = db.collection("posts").doc();
  await db.runTransaction(async (transaction) => {
    const claimed = await transaction.get(claim);
    const existing = await transaction.get(db.collection("posts")
      .where("uid", "==", uid).where("dayKey", "==", dayKey).limit(1));
    if (claimed.exists || !existing.empty) {
      throw new functions.https.HttpsError("already-exists", "Already posted today");
    }
    transaction.create(claim, { postId: ref.id });
    transaction.create(ref, {
      uid,
      createdAt: FieldValue.serverTimestamp(),
      dayKey,
      caption,
      visibility,
      media,
      status: "active",
      reacts: { sparkle: 0, crystal: 0 },
      reports: 0,
    });
  });
  return { postId: ref.id, visibility };
});

// ——— read-only shared daily feed —————————————————————————
export const getDailyWishes = functions.https.onCall(async (data) => {
  const parsed = dailyFeedSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const now = DateTime.fromMillis(serverMillis()).setZone(parsed.data.tzId);
  const start = now.startOf("day");
  const end = start.plus({ days: 1 });
  let query: FirebaseFirestore.Query = db.collection("posts")
    .where("status", "==", "active")
    .where("createdAt", ">=", Timestamp.fromMillis(start.toMillis()))
    .where("createdAt", "<", Timestamp.fromMillis(end.toMillis()))
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId());
  if (parsed.data.cursor) {
    const cursor = await db.collection("posts").doc(parsed.data.cursor.id).get();
    if (!cursor.exists) throw new functions.https.HttpsError("invalid-argument", "Invalid feed cursor");
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(FETCH_SIZE).get();
  const visible = snapshot.docs.map((document) => ({ document, wish: visibleFeedWish(document) }))
    .filter((entry) => entry.wish !== null);
  const selected = visible.slice(0, PAGE_SIZE);
  const wishes = selected.map((entry) => entry.wish);
  const scanned = selected[selected.length - 1]?.document;
  return {
    wishes,
    cursor: wishes.length === PAGE_SIZE && scanned ? cursorFor(scanned) : null,
    hasMore: visible.length > PAGE_SIZE || snapshot.docs.length === FETCH_SIZE,
  };
});

// ——— authenticated personal journal ——————————————————————
export const getMyWishes = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = historySchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  let query: FirebaseFirestore.Query = db.collection("posts").where("uid", "==", uid).orderBy("createdAt", "desc");
  if (parsed.data.cursor) {
    const cursor = await db.collection("posts").doc(parsed.data.cursor.id).get();
    if (!cursor.exists) throw new functions.https.HttpsError("invalid-argument", "Invalid history cursor");
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(PAGE_SIZE + 1).get();
  const page = snapshot.docs.slice(0, PAGE_SIZE);
  return {
    wishes: page.map(ownedWish).filter((wish) => wish !== null),
    cursor: snapshot.docs.length > PAGE_SIZE ? cursorFor(page[page.length - 1]) : null,
    hasMore: snapshot.docs.length > PAGE_SIZE,
  };
});

// ——— authenticated private image bytes ———————————————————
export const getPrivateImage = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = privateImageSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const file = await verifyOwnedImage(uid, { type: "image", storagePath: parsed.data.storagePath });
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.visibility !== "private") {
    throw new functions.https.HttpsError("permission-denied", "Image is not private");
  }
  const [bytes] = await file.download();
  return { dataUrl: `data:${metadata.contentType};base64,${bytes.toString("base64")}` };
});
