
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

// TODO: Replace with your Firebase web config (console → Project settings)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// Auto anon sign-in
signInAnonymously(auth).catch(() => {});

// Callables
export const getServerTimeCallable = httpsCallable(functions, "getServerTime");
export const canPostCallable = httpsCallable(functions, "canPost");
export const submitPostCallable = httpsCallable(functions, "submitPost");
