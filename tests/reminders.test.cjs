const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../functions/node_modules/typescript");

const values = new Map();
const cancelled = [];
const scheduled = [];
let granted = true;
let requests = 0;
let timezone = "America/Toronto";
const AsyncStorage = {
  getItem: async (key) => values.get(key) ?? null,
  setItem: async (key, value) => values.set(key, value),
};
const Notifications = {
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: "daily" },
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted }),
  requestPermissionsAsync: async () => { requests += 1; return { granted }; },
  cancelScheduledNotificationAsync: async (id) => { cancelled.push(id); },
  scheduleNotificationAsync: async (request) => { scheduled.push(request); return `scheduled-${scheduled.length}`; },
};
const source = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/lib/reminders.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const reminders = {};
new Function("require", "exports", compiled.outputText)((name) => {
  if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (name === "react-native") return { Platform: { OS: "ios" }, AppState: { addEventListener: () => ({ remove() {} }) } };
  if (name === "expo-notifications") return Notifications;
  throw new Error(`Unexpected module ${name}`);
}, reminders);
const originalDateTimeFormat = Intl.DateTimeFormat;
Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: timezone }) });

test("reminders schedule AM/PM, cancel disabled slots, and rebuild after timezone changes", async () => {
  const both = await reminders.setReminderSelection({ am: true, pm: true });
  assert.equal(both.permission, "granted");
  assert.deepEqual(scheduled.map((request) => request.trigger.hour), [11, 23]);
  assert(scheduled.every((request) => request.trigger.type === "daily"));

  const pmOnly = await reminders.setReminderSelection({ am: false, pm: true });
  assert.equal(pmOnly.settings.notificationIds.length, 1);
  assert.equal(cancelled.length, 2);
  const requestCount = requests;
  await reminders.setReminderSelection({ am: false, pm: false });
  assert.equal(requests, requestCount, "disabling must not request permission");

  await reminders.setReminderSelection({ am: true, pm: false });
  timezone = "Asia/Kolkata";
  const rescheduled = await reminders.syncReminderTimezone();
  assert.equal(rescheduled.timezone, "Asia/Kolkata");
  assert.equal(rescheduled.notificationIds.length, 1);
});

test("reminder enable keeps the device setting and reports denied permission without scheduling", async () => {
  values.clear();
  scheduled.length = 0;
  cancelled.length = 0;
  granted = false;
  const result = await reminders.setReminderSelection({ am: true, pm: false });
  assert.equal(result.permission, "denied");
  assert.equal(result.settings.am, true);
  assert.equal(result.settings.notificationIds.length, 0);
  assert.equal(scheduled.length, 0);
  granted = true;
});

test.after(() => { Intl.DateTimeFormat = originalDateTimeFormat; });
