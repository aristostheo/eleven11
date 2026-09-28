/**
 * Development-only Firebase Emulator Suite configuration.
 * EXPO_PUBLIC_* values are bundled by Expo, so never set these in a release
 * build or point them at a live project.
 */
export const emulatorEnabled =
  __DEV__ && process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === "1";

export const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";

const parseMillis = (value: string | undefined) => {
  if (!value) return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : undefined;
};

/** Virtual clock anchor shared with the Functions emulator. */
export const emulatorNowMillis = emulatorEnabled
  ? parseMillis(process.env.EXPO_PUBLIC_ELEVEN11_EMULATOR_NOW)
  : undefined;

/** Optional arbitrary test-window start, also shared with Functions. */
export const emulatorWindowStartMillis = emulatorEnabled
  ? parseMillis(process.env.EXPO_PUBLIC_ELEVEN11_EMULATOR_WINDOW_START)
  : undefined;
