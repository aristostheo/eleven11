import { useEffect } from "react";
import { Stack } from "expo-router";
import { ensureAuth } from "../src/lib/firebase";

export default function RootLayout() {
  useEffect(() => {
    ensureAuth().catch((error) => console.warn("Sign-in failed:", error));
  }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
