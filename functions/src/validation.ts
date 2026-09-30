import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

export const timezoneSchema = z.string().refine((zone) => IANAZone.isValidZone(zone));
export const visibilitySchema = z.enum(["private", "shared"]);
export const mediaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("image"),
    // Callers may name only an object in their own upload namespace. The
    // callable verifies the object and its owner metadata before publishing.
    storagePath: z.string().regex(/^uploads\/[^/]+\/[^/]+$/),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
  }),
]);

/**
 * Check the two daily 90-second windows, with an exclusive end.
 * @param {DateTime} now Server time in the validated timezone.
 * @return {boolean} Whether posting is open.
 */
export function inPostingWindow(now: DateTime): boolean {
  return [11, 23].some((hour) => {
    const start = now.set({ hour, minute: 11, second: 0, millisecond: 0 });
    return now >= start && now < start.plus({ seconds: 90 });
  });
}
