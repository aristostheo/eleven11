// functions/src/index.ts
import * as functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { z } from "zod";
import { inPostingWindow, timezoneSchema, mediaSchema } from "./validation";

initializeApp();
const db = getFirestore();

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

/** Return the real clock, or the advancing emulator clock when configured.
 * @return {number} Current server time in milliseconds.
 */
function serverMillis() {
  return Number.isFinite(emulatorNowAnchor)
    ? emulatorNowAnchor + (Date.now() - emulatorRealAnchor)
    : DateTime.now().toMillis();
}

/** Apply the optional emulator window without changing production behavior.
 * @param {DateTime} now Current virtual time in the requested zone.
 * @return {Object} Window state.
 */
function postingWindowFor(now: DateTime) {
  if (Number.isFinite(emulatorWindowStart)) {
    const start = DateTime.fromMillis(emulatorWindowStart).setZone(now.zoneName ?? "UTC");
    const end = start.plus({ seconds: 90 });
    return { start, end, open: now >= start && now < end };
  }
  return { open: inPostingWindow(now) };
}

// ——— getServerTime ————————————————————————————————
export const getServerTime = functions.https.onCall(async () => {
  return { serverMillis: serverMillis() };
});

// ——— canPost ————————————————————————————————————————
const CanPostSchema = z.object({
  tzId: timezoneSchema,
  // clientNow allowed but unused; useful if you want drift checks later
  clientNow: z.number().optional(),
});

export const canPost = functions.https.onCall(async (data, context) => {
  const parsed = CanPostSchema.safeParse(data);
  if (!parsed.success) {
    throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  }
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const { tzId } = parsed.data;
  const now = DateTime.fromMillis(serverMillis()).setZone(tzId);
  const dayKey = now.toISODate();

  // 11:11 window = 90 seconds
  const inWindow = postingWindowFor(now).open;

  // one post per day
  const existing = await db
    .collection("posts")
    .where("uid", "==", context.auth.uid)
    .where("dayKey", "==", dayKey)
    .limit(1)
    .get();

  const reason = inWindow
    ? existing.empty
      ? null
      : "already-posted"
    : "outside-window";

  return { allowed: inWindow && existing.empty, reason, dayKey };
});

// ——— submitPost ————————————————————————————————————
const SubmitSchema = z.object({
  tzId: timezoneSchema,
  caption: z.string().trim().min(1).max(280),
  media: mediaSchema,
});

export const submitPost = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) {
    throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  }

  const { tzId, caption, media } = parsed.data;

  // re-check the window server-side
  const now = DateTime.fromMillis(serverMillis()).setZone(tzId);
  const dayKey = now.toISODate();
  if (!postingWindowFor(now).open) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Not in 11:11 window"
    );
  }

  // Serialize submissions for this user/day, including simultaneous requests.
  const uid = context.auth.uid;
  const claim = db.collection("postClaims").doc(`${uid}_${dayKey}`);
  const ref = db.collection("posts").doc();
  await db.runTransaction(async (transaction) => {
    const claimed = await transaction.get(claim);
    // Also respect posts made before daily claims were introduced.
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
      media,
      status: "active",
      reacts: { sparkle: 0, crystal: 0 },
      reports: 0,
    });
  });

  return { postId: ref.id };
});
