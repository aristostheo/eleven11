import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

export type ReminderSelection = { am: boolean; pm: boolean };
export type ReminderSettings = ReminderSelection & {
  timezone: string;
  notificationIds: string[];
};
export type ReminderResult = {
  settings: ReminderSettings;
  permission: "granted" | "denied" | "unavailable";
};

const KEY = "eleven11:reminders:v1";
const defaultSelection: ReminderSelection = { am: false, pm: false };
const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
const emptySettings = (selection: ReminderSelection = defaultSelection): ReminderSettings => ({
  ...selection,
  timezone: deviceTimezone(),
  notificationIds: [],
});

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return emptySettings();
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      am: parsed.am === true,
      pm: parsed.pm === true,
      timezone: typeof parsed.timezone === "string" ? parsed.timezone : deviceTimezone(),
      notificationIds: Array.isArray(parsed.notificationIds) ? parsed.notificationIds : [],
    };
  } catch {
    return emptySettings();
  }
}

async function save(settings: ReminderSettings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

async function cancel(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

function notificationContent(period: "AM" | "PM") {
  return {
    title: "11:11 is almost here ✨",
    body: `Your ${period} wish window opens now.`,
    sound: "default" as const,
    data: { screen: "/", reminder: period },
  };
}

async function schedule(selection: ReminderSelection, timezone: string) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("eleven11-window", {
      name: "11:11 reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const schedules: Array<Promise<string>> = [];
  if (selection.am) schedules.push(Notifications.scheduleNotificationAsync({
    content: notificationContent("AM"),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 11, minute: 11, channelId: "eleven11-window" },
  }));
  if (selection.pm) schedules.push(Notifications.scheduleNotificationAsync({
    content: notificationContent("PM"),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 23, minute: 11, channelId: "eleven11-window" },
  }));
  const notificationIds = await Promise.all(schedules);
  return { ...selection, timezone, notificationIds };
}

async function notificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return "granted" as const;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted ? "granted" as const : "denied" as const;
}

/** Enable/disable local reminders. Permission is requested only when enabling. */
export async function setReminderSelection(selection: ReminderSelection): Promise<ReminderResult> {
  const previous = await loadReminderSettings();
  const timezone = deviceTimezone();
  if (!selection.am && !selection.pm) {
    await cancel(previous.notificationIds);
    const settings = { ...selection, timezone, notificationIds: [] };
    await save(settings);
    return { settings, permission: "granted" };
  }
  if (Platform.OS === "web") {
    const settings = { ...selection, timezone, notificationIds: [] };
    await save(settings);
    return { settings, permission: "unavailable" };
  }
  const permission = await notificationPermission();
  if (permission !== "granted") {
    const settings = { ...selection, timezone, notificationIds: [] };
    await save(settings);
    return { settings, permission };
  }
  await cancel(previous.notificationIds);
  const settings = await schedule(selection, timezone);
  await save(settings);
  return { settings, permission };
}

/** Rebuild device-local calendar schedules after a timezone change; never prompts. */
export async function syncReminderTimezone(): Promise<ReminderSettings> {
  const settings = await loadReminderSettings();
  const timezone = deviceTimezone();
  if ((!settings.am && !settings.pm) || settings.timezone === timezone || Platform.OS === "web") return settings;
  const permission = await Notifications.getPermissionsAsync();
  await cancel(settings.notificationIds);
  const next = permission.granted
    ? await schedule({ am: settings.am, pm: settings.pm }, timezone)
    : { ...settings, timezone, notificationIds: [] };
  await save(next);
  return next;
}

/** Refresh reminder timezone handling whenever the app returns to the foreground. */
export function startReminderTimezoneSync() {
  void syncReminderTimezone();
  return AppState.addEventListener("change", (state) => {
    if (state === "active") void syncReminderTimezone();
  });
}
