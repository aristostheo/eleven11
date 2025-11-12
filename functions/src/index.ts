
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DateTime } from 'luxon';
import { z } from 'zod';

admin.initializeApp();
const db = admin.firestore();

export const getServerTime = functions.https.onCall(async (_data, _ctx) => {
  return { serverMillis: Date.now() };
});

const CanPostSchema = z.object({
  tzId: z.string(),
  clientNow: z.number() // ms epoch
});

export const canPost = functions.https.onCall(async (data, context) => {
  const parsed = CanPostSchema.safeParse(data);
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Bad payload');
  }
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { tzId, clientNow } = parsed.data;
  const serverNow = DateTime.now().setZone(tzId);
  const dayKey = serverNow.toISODate();

  // 11:11 window = 90 seconds
  const start = serverNow.set({ hour: 11, minute: 11, second: 0, millisecond: 0 });
  const end = start.plus({ seconds: 90 });
  const allowed = serverNow >= start && serverNow <= end;

  // also ensure one post per day (by document query)
  const snap = await db.collection('posts')
    .where('uid', '==', context.auth.uid)
    .where('dayKey', '==', dayKey)
    .limit(1)
    .get();

  const reason = allowed ? (snap.empty ? null : 'already-posted') : 'outside-window';
  return { allowed: allowed && snap.empty, reason, dayKey };
});

const SubmitSchema = z.object({
  tzId: z.string(),
  caption: z.string().max(280),
  media: z.object({
    url: z.string().url().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    type: z.enum(['image', 'none'])
  })
});

export const submitPost = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Bad payload');
  }

  const { tzId, caption, media } = parsed.data;
  // Server-side validate time gate again
  const now = DateTime.now().setZone(tzId);
  const dayKey = now.toISODate();
  const start = now.set({ hour: 11, minute: 11, second: 0, millisecond: 0 });
  const end = start.plus({ seconds: 90 });
  if (!(now >= start && now <= end)) {
    throw new functions.https.HttpsError('failed-precondition', 'Not in 11:11 window');
  }

  // Enforce one per day
  const snap = await db.collection('posts')
    .where('uid', '==', context.auth.uid)
    .where('dayKey', '==', dayKey)
    .limit(1)
    .get();
  if (!snap.empty) {
    throw new functions.https.HttpsError('already-exists', 'Already posted today');
  }

  const postRef = db.collection('posts').doc();
  await postRef.set({
    uid: context.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    dayKey,
    caption,
    media,
    status: 'active',
    reacts: { sparkle: 0, crystal: 0 },
    reports: 0
  });

  return { postId: postRef.id };
});
