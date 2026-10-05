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
const reactionSchema = z.object({ postId: z.string().min(1).max(150).regex(/^[^/]+$/) });
const postIdSchema = z.object({ postId: z.string().min(1).max(150).regex(/^[^/]+$/) });
const reportReasonSchema = z.enum(["spam", "abuse", "harassment", "other"]);
const reportSchema = postIdSchema.extend({
  reason: reportReasonSchema,
  details: z.string().trim().max(500).optional().default(""),
});
const moderationDecisionSchema = z.object({
  reportId: z.string().min(1).max(200).regex(/^[^/]+$/),
  action: z.enum(["dismiss", "hide"]),
});
const initializePostingProfileSchema = z.object({ deviceTimezone: timezoneSchema }).strict();
const updatePostingTimezoneSchema = z.object({ timezone: timezoneSchema }).strict();
const emptyPayloadSchema = z.object({}).strict();
const REPORT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 5;
const TIMEZONE_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const POST_TIMEZONE_LOCK_MS = 24 * 60 * 60 * 1000;

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

function requireModerator(context: functions.https.CallableContext) {
  const uid = requireAuth(context);
  if (context.auth?.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Moderator access required");
  }
  return uid;
}

type PostingProfile = {
  timezone: string;
  timezoneUpdatedAtMillis: number;
  lastPostAtMillis: number | null;
};

function millisOf(value: unknown): number | null {
  return value && typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis: () => number }).toMillis()
    : null;
}

function readPostingProfile(snapshot: FirebaseFirestore.DocumentSnapshot): PostingProfile {
  const data = snapshot.data();
  if (!data) {
    throw new functions.https.HttpsError("failed-precondition", "Set a valid posting timezone before posting");
  }
  const timezone = data?.postingTimezone;
  if (typeof timezone !== "string" || !timezoneSchema.safeParse(timezone).success) {
    throw new functions.https.HttpsError("failed-precondition", "Set a valid posting timezone before posting");
  }
  return {
    timezone,
    timezoneUpdatedAtMillis: millisOf(data.timezoneUpdatedAt) ?? 0,
    lastPostAtMillis: millisOf(data.lastPostAt),
  };
}

function postingProfileResponse(profile: PostingProfile) {
  const nextTimezoneChangeMillis = profile.timezoneUpdatedAtMillis + TIMEZONE_CHANGE_COOLDOWN_MS;
  const postTimezoneLockUntilMillis = profile.lastPostAtMillis === null
    ? null
    : profile.lastPostAtMillis + POST_TIMEZONE_LOCK_MS;
  return {
    timezone: profile.timezone,
    nextTimezoneChangeMillis,
    postTimezoneLockUntilMillis,
  };
}

async function getPostingProfileFor(uid: string): Promise<PostingProfile> {
  const snapshot = await db.collection("users").doc(uid).get();
  return readPostingProfile(snapshot);
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
    w: data.media.w as number | undefined,
    h: data.media.h as number | undefined,
  };
}

function visibleFeedWish(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  viewerReacted = false
) {
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
    reactions: {
      sparkle: Math.max(0, Number(data.reacts?.sparkle ?? 0)),
      viewerReacted,
    },
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
    status: data.status === "hidden" ? "hidden" : "active",
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

/** Disable feed access and download tokens for a hidden shared image. */
async function hideSharedImage(storagePath: string) {
  const file = bucket.file(storagePath);
  const [existing] = await file.getMetadata();
  await file.setMetadata({
    metadata: {
      ...existing.metadata,
      visibility: "hidden",
      firebaseStorageDownloadTokens: null,
    },
  });
}

// ——— getServerTime ——————————————————————————————————————
export const getServerTime = functions.https.onCall(async () => ({ serverMillis: serverMillis() }));

// ——— server-owned posting timezone ———————————————————————
export const initializePostingProfile = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = initializePostingProfileSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const user = db.collection("users").doc(uid);
  const now = Timestamp.fromMillis(serverMillis());
  const profile = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(user);
    if (snapshot.exists) {
      const data = snapshot.data();
      if (typeof data?.postingTimezone === "string" && timezoneSchema.safeParse(data.postingTimezone).success) {
        return readPostingProfile(snapshot);
      }
      // Older server-created user records did not carry a posting timezone.
      // Initialize that one missing field once; callers still cannot change it
      // through canPost or submitPost.
      transaction.set(user, {
        postingTimezone: parsed.data.deviceTimezone,
        timezoneUpdatedAt: now,
      }, { merge: true });
    } else {
      transaction.create(user, {
        postingTimezone: parsed.data.deviceTimezone,
        timezoneUpdatedAt: now,
        createdAt: now,
      });
    }
    return {
      timezone: parsed.data.deviceTimezone,
      timezoneUpdatedAtMillis: now.toMillis(),
      lastPostAtMillis: null,
    };
  });
  return postingProfileResponse(profile);
});

export const getPostingProfile = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  if (!emptyPayloadSchema.safeParse(data).success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  return postingProfileResponse(await getPostingProfileFor(uid));
});

export const getIdentityStatus = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  if (!emptyPayloadSchema.safeParse(data).success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const wishes = await db.collection("posts").where("uid", "==", uid).limit(1).get();
  return { hasWishes: !wishes.empty };
});

export const updatePostingTimezone = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = updatePostingTimezoneSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const user = db.collection("users").doc(uid);
  const nowMillis = serverMillis();
  const profile = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(user);
    const current = readPostingProfile(snapshot);
    if (current.timezone === parsed.data.timezone) return current;
    const postLockUntilMillis = current.lastPostAtMillis === null
      ? 0
      : current.lastPostAtMillis + POST_TIMEZONE_LOCK_MS;
    if (nowMillis < postLockUntilMillis) {
      throw new functions.https.HttpsError("failed-precondition", "Timezone stays locked for 24 hours after posting");
    }
    const nextTimezoneChangeMillis = current.timezoneUpdatedAtMillis + TIMEZONE_CHANGE_COOLDOWN_MS;
    if (nowMillis < nextTimezoneChangeMillis) {
      throw new functions.https.HttpsError("failed-precondition", "Timezone can be changed once every 7 days");
    }
    const updatedAt = Timestamp.fromMillis(nowMillis);
    transaction.update(user, {
      postingTimezone: parsed.data.timezone,
      timezoneUpdatedAt: updatedAt,
    });
    return { ...current, timezone: parsed.data.timezone, timezoneUpdatedAtMillis: nowMillis };
  });
  return postingProfileResponse(profile);
});

// ——— canPost ————————————————————————————————————————————

export const canPost = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  if (!emptyPayloadSchema.safeParse(data).success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const profile = await getPostingProfileFor(uid);
  const now = DateTime.fromMillis(serverMillis()).setZone(profile.timezone);
  const dayKey = now.toISODate();
  const existing = await db.collection("posts").where("uid", "==", uid).where("dayKey", "==", dayKey).limit(1).get();
  const inWindow = postingWindowFor(now).open;
  return {
    allowed: inWindow && existing.empty,
    reason: !inWindow ? "outside-window" : existing.empty ? null : "already-posted",
    dayKey,
    timezone: profile.timezone,
  };
});

// ——— submitPost —————————————————————————————————————————
const SubmitSchema = z.object({
  caption: z.string().trim().min(1).max(280),
  visibility: visibilitySchema,
  media: mediaSchema,
}).strict();

export const submitPost = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const { caption, visibility, media } = parsed.data;
  const profile = await getPostingProfileFor(uid);
  const nowMillis = serverMillis();
  const now = DateTime.fromMillis(nowMillis).setZone(profile.timezone);
  const dayKey = now.toISODate();
  if (!postingWindowFor(now).open) {
    throw new functions.https.HttpsError("failed-precondition", "Not in 11:11 window");
  }

  const imageFile = media.type === "image" ? await verifyOwnedImage(uid, media) : null;
  // The visibility is written only by the backend after it verified path and
  // owner metadata. A private object never receives a public download token.
  if (imageFile) await markImageVisibility(imageFile, uid, visibility);

  const claim = db.collection("postClaims").doc(`${uid}_${dayKey}`);
  const user = db.collection("users").doc(uid);
  const ref = db.collection("posts").doc();
  await db.runTransaction(async (transaction) => {
    const [profileSnapshot, claimed, existing] = await Promise.all([
      transaction.get(user),
      transaction.get(claim),
      transaction.get(db.collection("posts")
        .where("uid", "==", uid).where("dayKey", "==", dayKey).limit(1)),
    ]);
    const currentProfile = readPostingProfile(profileSnapshot);
    if (currentProfile.timezone !== profile.timezone) {
      throw new functions.https.HttpsError("failed-precondition", "Posting timezone changed; try again");
    }
    if (claimed.exists || !existing.empty) {
      throw new functions.https.HttpsError("already-exists", "Already posted today");
    }
    transaction.create(claim, { postId: ref.id });
    transaction.create(ref, {
      uid,
      createdAt: Timestamp.fromMillis(nowMillis),
      dayKey,
      caption,
      visibility,
      media,
      status: "active",
      reacts: { sparkle: 0, crystal: 0 },
      reports: 0,
    });
    transaction.update(user, {
      lastPostAt: Timestamp.fromMillis(nowMillis),
      lastPostDayKey: dayKey,
    });
  });
  return { postId: ref.id, visibility, timezone: profile.timezone };
});

// ——— read-only shared daily feed —————————————————————————
export const getDailyWishes = functions.https.onCall(async (data, context) => {
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
  const visible = snapshot.docs.filter((document) => document.get("visibility") !== "private");
  const selected = visible.slice(0, PAGE_SIZE);
  const viewerUid = context.auth?.uid;
  const reactionSnapshots = viewerUid
    ? await db.getAll(...selected.map((document) =>
      document.ref.collection("reactions").doc(viewerUid)))
    : [];
  const wishes = selected.map((document, index) =>
    visibleFeedWish(document, reactionSnapshots[index]?.exists ?? false));
  const scanned = selected[selected.length - 1];
  return {
    wishes,
    cursor: wishes.length === PAGE_SIZE && scanned ? cursorFor(scanned) : null,
    hasMore: visible.length > PAGE_SIZE || snapshot.docs.length === FETCH_SIZE,
  };
});

// ——— one anonymous sparkle reaction per shared active post —————————————
export const toggleSparkleReaction = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = reactionSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const post = db.collection("posts").doc(parsed.data.postId);
  const reaction = post.collection("reactions").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(post);
    if (!snapshot.exists) throw new functions.https.HttpsError("not-found", "Wish not found");
    const wish = snapshot.data();
    if (!wish) throw new functions.https.HttpsError("not-found", "Wish not found");
    if (wish.status !== "active" || wish.visibility === "private") {
      throw new functions.https.HttpsError("permission-denied", "Wish is not reactable");
    }
    const prior = await transaction.get(reaction);
    const current = Math.max(0, Number(wish.reacts?.sparkle ?? 0));
    if (prior.exists) {
      transaction.delete(reaction);
      const sparkle = Math.max(0, current - 1);
      transaction.update(post, { "reacts.sparkle": sparkle });
      return { postId: post.id, reacted: false, count: sparkle };
    }
    transaction.create(reaction, { createdAt: FieldValue.serverTimestamp() });
    const sparkle = current + 1;
    transaction.update(post, { "reacts.sparkle": sparkle });
    return { postId: post.id, reacted: true, count: sparkle };
  });
});

// ——— report an anonymously shared active wish —————————————————
export const reportWish = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const parsed = reportSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const post = db.collection("posts").doc(parsed.data.postId);
  const report = db.collection("reports").doc(`${post.id}_${uid}`);
  const rateLimit = db.collection("reportRateLimits").doc(uid);
  const nowMillis = serverMillis();
  await db.runTransaction(async (transaction) => {
    const [postSnapshot, reportSnapshot, rateSnapshot] = await Promise.all([
      transaction.get(post), transaction.get(report), transaction.get(rateLimit),
    ]);
    if (!postSnapshot.exists) throw new functions.https.HttpsError("not-found", "Wish not found");
    const wish = postSnapshot.data();
    if (!wish || wish.status !== "active" || wish.visibility === "private") {
      throw new functions.https.HttpsError("permission-denied", "Wish cannot be reported");
    }
    if (reportSnapshot.exists) {
      throw new functions.https.HttpsError("already-exists", "You already reported this wish");
    }
    const previous = rateSnapshot.data();
    const inWindow = typeof previous?.windowStartMillis === "number"
      && nowMillis - previous.windowStartMillis < REPORT_WINDOW_MS;
    const count = inWindow ? Number(previous?.count ?? 0) : 0;
    if (count >= MAX_REPORTS_PER_WINDOW) {
      throw new functions.https.HttpsError("resource-exhausted", "Too many reports; try again later");
    }
    transaction.set(rateLimit, {
      windowStartMillis: inWindow ? previous.windowStartMillis : nowMillis,
      count: count + 1,
      updatedAt: Timestamp.fromMillis(nowMillis),
    });
    transaction.create(report, {
      postId: post.id,
      reporterUid: uid,
      reason: parsed.data.reason,
      details: parsed.data.details,
      wishCaption: wish.caption,
      status: "pending",
      createdAt: Timestamp.fromMillis(nowMillis),
    });
  });
  return { postId: post.id, reported: true };
});

// ——— admin-only moderation review ————————————————————————
export const getModerationReports = functions.https.onCall(async (_data, context) => {
  requireModerator(context);
  const reports = await db.collection("reports")
    .where("status", "in", ["pending", "repair-needed"])
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  if (reports.empty) return { reports: [] };
  const posts = await db.getAll(...reports.docs.map((report) =>
    db.collection("posts").doc(report.get("postId"))));
  return {
    reports: reports.docs.map((report, index) => {
      const data = report.data();
      const post = posts[index];
      const createdAt = data.createdAt as FirebaseFirestore.Timestamp | undefined;
      return {
        id: report.id,
        postId: data.postId as string,
        reason: data.reason as string,
        details: data.details as string,
        caption: data.wishCaption as string,
        createdAtMillis: createdAt?.toMillis() ?? 0,
        postStatus: post?.exists ? (post.get("status") as string) : "missing",
        hasImage: post?.get("media")?.type === "image",
        needsImageRepair: data.status === "repair-needed",
      };
    }),
  };
});

export const decideModerationReport = functions.https.onCall(async (data, context) => {
  const moderatorUid = requireModerator(context);
  const parsed = moderationDecisionSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const report = db.collection("reports").doc(parsed.data.reportId);
  let hiddenStoragePath: string | null = null;
  let imageNeedsRepair = false;
  await db.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(report);
    if (!reportSnapshot.exists) throw new functions.https.HttpsError("not-found", "Report not found");
    const reportData = reportSnapshot.data();
    const retryingImageRepair = reportData?.status === "repair-needed" && parsed.data.action === "hide";
    if (!reportData || (reportData.status !== "pending" && !retryingImageRepair)) {
      throw new functions.https.HttpsError("failed-precondition", "Report was already decided");
    }
    const now = Timestamp.fromMillis(serverMillis());
    const decision = retryingImageRepair ? reportData.decision : {
      action: parsed.data.action,
      moderatorUid,
      decidedAt: now,
    };
    if (parsed.data.action === "dismiss") {
      transaction.update(report, { status: "dismissed", decision });
      return;
    }
    const post = db.collection("posts").doc(reportData.postId);
    const postSnapshot = await transaction.get(post);
    if (!postSnapshot.exists) throw new functions.https.HttpsError("not-found", "Wish not found");
    const wish = postSnapshot.data();
    const canHide = retryingImageRepair
      ? wish?.status === "hidden" && wish.visibility !== "private"
      : wish?.status === "active" && wish.visibility !== "private";
    if (!wish || !canHide) {
      throw new functions.https.HttpsError("failed-precondition", "Wish cannot be hidden");
    }
    hiddenStoragePath = wish.media?.type === "image" ? wish.media.storagePath as string : null;
    imageNeedsRepair = Boolean(hiddenStoragePath);
    if (!retryingImageRepair) {
      // Hide in Firestore first so feed and callable access stop immediately,
      // even when the separate Storage metadata operation fails.
      transaction.update(post, { status: "hidden", moderation: decision });
    }
    transaction.update(report, imageNeedsRepair ? {
      status: "repair-needed",
      decision,
      mediaRevocation: { status: "pending", attemptedAt: now, attemptedBy: moderatorUid },
    } : { status: "resolved", decision });
  });
  if (parsed.data.action === "hide" && hiddenStoragePath) {
    try {
      await hideSharedImage(hiddenStoragePath);
      await report.update({
        status: "resolved",
        mediaRevocation: {
          status: "complete",
          completedAt: Timestamp.fromMillis(serverMillis()),
          completedBy: moderatorUid,
        },
      });
    } catch {
      // The post stays hidden, but keep an admin-visible repair item instead
      // of claiming that a Storage URL/token was revoked successfully.
      await report.update({
        status: "repair-needed",
        mediaRevocation: {
          status: "failed",
          attemptedAt: Timestamp.fromMillis(serverMillis()),
          attemptedBy: moderatorUid,
        },
      });
      return { reportId: report.id, action: parsed.data.action, mediaRevocation: "failed" };
    }
  }
  return {
    reportId: report.id,
    action: parsed.data.action,
    mediaRevocation: imageNeedsRepair ? "complete" : "not-applicable",
  };
});

// ——— authenticated bytes for an active shared feed image —————————
export const getSharedImage = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const parsed = postIdSchema.safeParse(data);
  if (!parsed.success) throw new functions.https.HttpsError("invalid-argument", "Bad payload");
  const post = await db.collection("posts").doc(parsed.data.postId).get();
  if (!post.exists) throw new functions.https.HttpsError("not-found", "Wish not found");
  const wish = post.data();
  if (!wish || wish.status !== "active" || wish.visibility === "private" || wish.media?.type !== "image") {
    throw new functions.https.HttpsError("permission-denied", "Image is unavailable");
  }
  const storagePath = wish.media.storagePath as string | undefined;
  if (!storagePath) throw new functions.https.HttpsError("failed-precondition", "Image cannot be safely served");
  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.visibility !== "shared") {
    throw new functions.https.HttpsError("permission-denied", "Image is unavailable");
  }
  const [bytes] = await file.download();
  return { dataUrl: `data:${metadata.contentType};base64,${bytes.toString("base64")}` };
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
