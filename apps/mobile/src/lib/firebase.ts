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
  connectAuthEmulator,
  type User,
  type Persistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, connectStorageEmulator } from "firebase/storage";
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

export async function getSharedPhotoUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
}

export async function getPrivatePhotoDataUrl(storagePath: string): Promise<string> {
  const { data } = await _getPrivateImage({ storagePath }) as { data: { dataUrl: string } };
  return data.dataUrl;
}

export async function getServerTime(): Promise<number> {
  const { data } = await _getServerTime();
  if (!Number.isFinite(data.serverMillis)) throw new Error("Invalid server time");
  return data.serverMillis;
}

// Callable wrappers
export function canPost(payload: { tzId: string; clientNow: number }) {
  return _canPost(payload);
}
export function submitPost(payload: {
  tzId: string;
  caption: string;
  visibility: "private" | "shared";
  media: { type: "image" | "none"; storagePath?: string; w?: number; h?: number };
}) {
  return _submitPost(payload);
}

export function getDailyWishes(payload: { tzId: string; cursor?: { createdAtMillis: number; id: string } | null }) {
  return _getDailyWishes(payload);
}

export function getMyWishes(payload: { cursor?: { createdAtMillis: number; id: string } | null }) {
  return _getMyWishes(payload);
}
