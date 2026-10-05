import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { initializePostingProfile, isModerator, updatePostingTimezone, type PostingProfile } from "../src/lib/firebase";
import { loadReminderSettings, setReminderSelection, type ReminderSettings } from "../src/lib/reminders";

export default function Settings() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [moderator, setModerator] = useState(false);
  const [postingProfile, setPostingProfile] = useState<PostingProfile | null>(null);
  const [timezoneInput, setTimezoneInput] = useState("");

  useEffect(() => {
    void loadReminderSettings().then(setSettings).catch(() => setNotice("Couldn’t load reminder settings."));
    void isModerator().then(setModerator).catch(() => setModerator(false));
    const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    void initializePostingProfile(deviceTimezone).then((profile) => {
      setPostingProfile(profile);
      setTimezoneInput(profile.timezone);
    }).catch(() => setNotice("Couldn’t load posting timezone."));
  }, []);

  const changeTimezone = async () => {
    if (!postingProfile || updating) return;
    setUpdating(true);
    setNotice(null);
    try {
      const profile = await updatePostingTimezone(timezoneInput.trim());
      setPostingProfile(profile);
      setTimezoneInput(profile.timezone);
      setNotice(`Posting timezone updated to ${profile.timezone}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t update posting timezone.";
      setNotice(message);
    } finally {
      setUpdating(false);
    }
  };

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
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: "#0a0814", padding: 24, paddingTop: 64, gap: 22 }}>
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
      <View style={{ gap: 10, padding: 16, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" }}>
        <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>Posting timezone</Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>Your 11:11 window and one-post-per-day limit use this server-saved IANA timezone. Change it deliberately when travelling: changes are limited to once every 7 days and locked for 24 hours after a post.</Text>
        <TextInput value={timezoneInput} onChangeText={setTimezoneInput} editable={!updating} autoCapitalize="none" autoCorrect={false} placeholder="America/Toronto" placeholderTextColor="rgba(255,255,255,0.45)" style={{ color: "white", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1, borderRadius: 12, padding: 12 }} />
        <Pressable disabled={updating || !postingProfile} onPress={() => void changeTimezone()} style={{ alignSelf: "flex-start", backgroundColor: "white", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, opacity: updating || !postingProfile ? 0.6 : 1 }}><Text style={{ color: "#0a0814", fontWeight: "800" }}>{updating ? "Updating…" : "Update posting timezone"}</Text></Pressable>
      </View>
      <Pressable onPress={() => router.push("/account")} style={{ alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", paddingHorizontal: 16, paddingVertical: 11 }}><Text style={{ color: "white", fontWeight: "700" }}>Save my wishes</Text></Pressable>
      {moderator ? <Pressable onPress={() => router.push("/moderation")} style={{ alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", paddingHorizontal: 16, paddingVertical: 11 }}><Text style={{ color: "white", fontWeight: "700" }}>Review reports</Text></Pressable> : null}
      {notice ? <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16, padding: 14 }}><Text style={{ color: "rgba(255,255,255,0.85)", lineHeight: 20 }}>{notice}</Text></View> : null}
    </ScrollView>
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
