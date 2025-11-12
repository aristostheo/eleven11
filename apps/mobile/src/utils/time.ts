
import { DateTime } from "luxon";

export const dayKey = (tzId: string, millis?: number) =>
  DateTime.fromMillis(millis ?? Date.now(), { zone: tzId }).toISODate();

