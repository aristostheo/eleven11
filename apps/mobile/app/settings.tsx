import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { isModerator } from "../src/lib/firebase";
import { loadReminderSettings, setReminderSelection, type ReminderSettings } from "../src/lib/reminders";

export default function Settings() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [moderator, setModerator] = useState(false);

  useEffect(() => {
    void loadReminderSettings().then(setSettings).catch(() => setNotice("Couldn’t load reminder settings."));
    void isModerator().then(setModerator).catch(() => setModerator(false));
  }, []);

  const toggle = async (period: "am" | "pm") => {
    if (!settings || updating) return;
    setUpdating(true);
    setNotice(null);
    try {
      const result = await setReminderSelection({ ...settings, [period]: !settings[period] });
      setSettings(result.settings);
      if (result.permission === "denied") {
        setNotice("Notifications are off. Enable them for Eleven11 in iPhone Settings to receive reminders.");
      } else if (result.permission === "unavailable") {
        setNotice("Local reminders are available in the installed iPhone or Android app, not the web preview.");
      } else if (!result.settings.am && !result.settings.pm) {
        setNotice("All 11:11 reminders are off.");
      } else {
        setNotice(`Reminder${result.settings.am && result.settings.pm ? "s" : ""} scheduled in ${result.settings.timezone}.`);
      }
    } catch {
      setNotice("Couldn’t update reminders. Try again.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0814", padding: 24, paddingTop: 64, gap: 22 }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>← Back</Text>
      </Pressable>
      <View style={{ gap: 8 }}>
        <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>Settings</Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 21 }}>
          Optional local reminders open Eleven11 for your device’s 11:11 AM and PM windows. They follow your current device timezone.
        </Text>
      </View>
      {!settings ? <ActivityIndicator color="white" /> : <View style={{ gap: 12 }}>
        <ReminderToggle label="11:11 AM" enabled={settings.am} disabled={updating} onPress={() => void toggle("am")} />
        <ReminderToggle label="11:11 PM" enabled={settings.pm} disabled={updating} onPress={() => void toggle("pm")} />
        <Text style={{ color: "rgba(255,255,255,0.55)", marginTop: 4 }}>Timezone: {settings.timezone}</Text>
      </View>}
      {moderator ? <Pressable onPress={() => router.push("/moderation")} style={{ alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", paddingHorizontal: 16, paddingVertical: 11 }}><Text style={{ color: "white", fontWeight: "700" }}>Review reports</Text></Pressable> : null}
      {notice ? <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16, padding: 14 }}><Text style={{ color: "rgba(255,255,255,0.85)", lineHeight: 20 }}>{notice}</Text></View> : null}
    </View>
  );
}

function ReminderToggle({ label, enabled, disabled, onPress }: { label: string; enabled: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable
    onPress={onPress}
    disabled={disabled}
    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 18, padding: 16, backgroundColor: enabled ? "rgba(166,124,255,0.3)" : "rgba(255,255,255,0.1)", opacity: disabled ? 0.6 : 1 }}
  >
    <Text style={{ color: "white", fontSize: 17, fontWeight: "700" }}>{label}</Text>
    <Text style={{ color: "white", fontWeight: "700" }}>{enabled ? "On" : "Off"}</Text>
  </Pressable>;
}
