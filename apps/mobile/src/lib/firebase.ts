// apps/mobile/src/lib/firebase.ts
import { Platform } from "react-native";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

// Side-effect import ensures the Auth component is registered on RN
import "firebase/auth";

import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  linkWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
  connectAuthEmulator,
  type User,
  type Persistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, ref, uploadBytes, deleteObject, connectStorageEmulator } from "firebase/storage";
import { emulatorEnabled, emulatorHost } from "../utils/emulator";

// --- eleven11 config ---
const firebaseConfig = {
  apiKey: "AIzaSyAFHw1dLnbipOK7Nz1-tQ7wG1vqRwaRlAA",
  authDomain: "eleven11-aristos.firebaseapp.com",
  projectId: "eleven11-aristos",
  storageBucket: "eleven11-aristos.firebasestorage.app",
  messagingSenderId: "1071072560179",
  appId: "1:1071072560179:web:9e125149447e79203dcf46",
};

// Singleton app
export const app: FirebaseApp = getApps().length
  ? getApps()[0]!
  : initializeApp(firebaseConfig);

/**
 * Try to resolve getReactNativePersistence regardless of export location.
 * Returns a Persistence instance (typed) or undefined.
 */
function resolveRNPersistence(): Persistence | undefined {
  // Then try main entry (some versions re-export it)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require("firebase/auth");
    if (core?.getReactNativePersistence) {
      return core.getReactNativePersistence(AsyncStorage) as Persistence;
    }
  } catch {}
  return undefined;
}

// ---- Auth ----
const auth = (() => {
  if (Platform.OS === "web") {
    const a = getAuth(app);
    setPersistence(a, browserLocalPersistence).catch(() => {});
    return a;
  }

  const rnPersistence = resolveRNPersistence();
  try {
    if (rnPersistence) {
      return initializeAuth(app, { persistence: rnPersistence });
    }
    // No RN persistence available → initialize without explicit persistence (in-memory)
    return initializeAuth(app, {});
  } catch {
    // Already initialized (dev hot-reload) → safe to fall back
    return getAuth(app);
  }
})();

export { auth };

if (emulatorEnabled) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
}

// ---- Functions ----
const functions = getFunctions(app, "us-central1");
if (emulatorEnabled) connectFunctionsEmulator(functions, emulatorHost, 5001);
const storage = getStorage(app);
if (emulatorEnabled) connectStorageEmulator(storage, emulatorHost, 9199);
const _canPost = httpsCallable(functions, "canPost");
const _submitPost = httpsCallable(functions, "submitPost");
const _getServerTime = httpsCallable<undefined, { serverMillis: number }>(functions, "getServerTime");
const _getDailyWishes = httpsCallable(functions, "getDailyWishes");
const _getMyWishes = httpsCallable(functions, "getMyWishes");
const _getPrivateImage = httpsCallable(functions, "getPrivateImage");
const _toggleSparkleReaction = httpsCallable(functions, "toggleSparkleReaction");
const _getSharedImage = httpsCallable(functions, "getSharedImage");
const _reportWish = httpsCallable(functions, "reportWish");
const _getModerationReports = httpsCallable(functions, "getModerationReports");
const _decideModerationReport = httpsCallable(functions, "decideModerationReport");
const _initializePostingProfile = httpsCallable(functions, "initializePostingProfile");
const _getPostingProfile = httpsCallable(functions, "getPostingProfile");
const _updatePostingTimezone = httpsCallable(functions, "updatePostingTimezone");
const _getIdentityStatus = httpsCallable(functions, "getIdentityStatus");

// Ensure a signed-in user (silent anonymous)
let signInPromise: Promise<User> | null = null;
export async function ensureAuth(): Promise<User> {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  if (!signInPromise) {
    signInPromise = signInAnonymously(auth)
      .then(({ user }) => user)
      .finally(() => { signInPromise = null; });
  }
  return signInPromise;
}

export type UploadedPhoto = { storagePath: string; w?: number; h?: number };

export async function uploadPhoto(uri: string): Promise<UploadedPhoto> {
  const user = await ensureAuth();
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob.size >= 3 * 1024 * 1024) {
    throw new Error("Choose a photo smaller than 3 MB.");
  }
  const storagePath = `uploads/${user.uid}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const photoRef = ref(storage, storagePath);
  await uploadBytes(photoRef, blob, {
    contentType: blob.type || "image/jpeg",
    customMetadata: { ownerUid: user.uid, visibility: "pending" },
  });
  return { storagePath };
}

export async function deleteUploadedPhoto(storagePath: string): Promise<void> {
  await deleteObject(ref(storage, storagePath));
}

export async function getPrivatePhotoDataUrl(storagePath: string): Promise<string> {
  const { data } = await _getPrivateImage({ storagePath }) as { data: { dataUrl: string } };
  return data.dataUrl;
}

export async function getSharedPhotoDataUrl(postId: string): Promise<string> {
  const { data } = await _getSharedImage({ postId }) as { data: { dataUrl: string } };
  return data.dataUrl;
}

export async function getServerTime(): Promise<number> {
  const { data } = await _getServerTime();
  if (!Number.isFinite(data.serverMillis)) throw new Error("Invalid server time");
  return data.serverMillis;
}

export type PostingProfile = {
  timezone: string;
  nextTimezoneChangeMillis: number;
  postTimezoneLockUntilMillis: number | null;
};

export async function initializePostingProfile(deviceTimezone: string): Promise<PostingProfile> {
  await ensureAuth();
  const { data } = await _initializePostingProfile({ deviceTimezone }) as { data: PostingProfile };
  return data;
}

export async function getPostingProfile(): Promise<PostingProfile> {
  await ensureAuth();
  const { data } = await _getPostingProfile({}) as { data: PostingProfile };
  return data;
}

export async function updatePostingTimezone(timezone: string): Promise<PostingProfile> {
  await ensureAuth();
  const { data } = await _updatePostingTimezone({ timezone }) as { data: PostingProfile };
  return data;
}

export type IdentityStatus = { uid: string; isAnonymous: boolean; email: string | null; hasWishes: boolean };

export async function getIdentityStatus(): Promise<IdentityStatus> {
  const user = await ensureAuth();
  const { data } = await _getIdentityStatus({}) as { data: { hasWishes: boolean } };
  return { uid: user.uid, isAnonymous: user.isAnonymous, email: user.email, hasWishes: data.hasWishes };
}

/** Links email/password credentials to the existing anonymous Firebase UID. */
export async function saveAnonymousWishes(email: string, password: string): Promise<User> {
  const user = await ensureAuth();
  if (!user.isAnonymous) throw new Error("This identity is already saved. Sign out before using another account.");
  const { user: linked } = await linkWithCredential(user, EmailAuthProvider.credential(email.trim(), password));
  await linked.getIdToken(true);
  return linked;
}

/**
 * A caller must explicitly opt in before replacing an anonymous identity that
 * already owns wishes. Authentication is attempted before changing local state,
 * so invalid credentials leave that identity signed in.
 */
export async function signInExistingAccount(email: string, password: string, allowWishIdentityReplacement = false): Promise<{ requiresWarning: boolean; user?: User }> {
  const current = await ensureAuth();
  if (!current.isAnonymous) throw new Error("Sign out before signing into another account.");
  const { data } = await _getIdentityStatus({}) as { data: { hasWishes: boolean } };
  if (data.hasWishes && !allowWishIdentityReplacement) return { requiresWarning: true };
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  return { requiresWarning: false, user };
}

export async function sendAccountRecovery(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/** Explicitly leaves the current saved account and starts a new anonymous identity. */
export async function signOutToAnonymous(): Promise<User> {
  await signOut(auth);
  const { user } = await signInAnonymously(auth);
  return user;
}

// Callable wrappers
export async function canPost() {
  await ensureAuth();
  return _canPost({});
}
export function submitPost(payload: {
  caption: string;
  visibility: "private" | "shared";
  media: { type: "image" | "none"; storagePath?: string; w?: number; h?: number };
}) {
  return _submitPost(payload);
}

export async function getDailyWishes(payload: { tzId: string; cursor?: { createdAtMillis: number; id: string } | null }) {
  await ensureAuth();
  return _getDailyWishes(payload);
}

export function getMyWishes(payload: { cursor?: { createdAtMillis: number; id: string } | null }) {
  return _getMyWishes(payload);
}

export async function toggleSparkleReaction(postId: string) {
  await ensureAuth();
  return _toggleSparkleReaction({ postId });
}

export async function reportWish(payload: {
  postId: string;
  reason: "spam" | "abuse" | "harassment" | "other";
  details?: string;
}) {
  await ensureAuth();
  return _reportWish(payload);
}

export type ModerationReport = {
  id: string;
  postId: string;
  reason: string;
  details: string;
  caption: string;
  createdAtMillis: number;
  postStatus: "active" | "hidden" | "missing";
  hasImage: boolean;
  needsImageRepair: boolean;
};

export async function getModerationReports(): Promise<ModerationReport[]> {
  const { data } = await _getModerationReports({}) as { data: { reports: ModerationReport[] } };
  return data.reports;
}

export async function decideModerationReport(reportId: string, action: "dismiss" | "hide") {
  const { data } = await _decideModerationReport({ reportId, action }) as {
    data: { reportId: string; action: "dismiss" | "hide"; mediaRevocation: "complete" | "failed" | "not-applicable" };
  };
  return data;
}

export async function isModerator(): Promise<boolean> {
  const user = await ensureAuth();
  const token = await user.getIdTokenResult();
  return token.claims.admin === true;
}
