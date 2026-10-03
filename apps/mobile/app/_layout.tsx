import { useEffect } from "react";
import { Stack } from "expo-router";
import { ensureAuth } from "../src/lib/firebase";
import { startReminderTimezoneSync } from "../src/lib/reminders";

export default function RootLayout() {
  useEffect(() => {
    ensureAuth().catch((error) => console.warn("Sign-in failed:", error));
    const subscription = startReminderTimezoneSync();
    return () => subscription.remove();
  }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
