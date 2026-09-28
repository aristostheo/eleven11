import { DateTime } from "luxon";

export const WINDOW_SECONDS = 90;
export function postingWindow(now: DateTime) {
  const windows = [11, 23].map((hour) => {
    const start = now.set({ hour, minute: 11, second: 0, millisecond: 0 });
    return { start, end: start.plus({ seconds: WINDOW_SECONDS }) };
  });
  const window = windows.find(({ end }) => now < end) ?? {
    start: windows[0].start.plus({ days: 1 }),
    end: windows[0].end.plus({ days: 1 }),
  };
  return { ...window, open: now >= window.start && now < window.end };
}

export const dayKey = (tzId: string, millis?: number) =>
  DateTime.fromMillis(millis ?? Date.now(), { zone: tzId }).toISODate();
