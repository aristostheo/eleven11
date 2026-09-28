import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

export const timezoneSchema = z.string().refine((zone) => IANAZone.isValidZone(zone));
const allowEmulatorHttpMedia = process.env.FUNCTIONS_EMULATOR === "true";
export const mediaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("image"),
    // Storage Emulator download URLs are HTTP. Deployed functions continue to
    // require HTTPS media URLs.
    url: z.string().url().refine((url) =>
      url.startsWith("https://") || (allowEmulatorHttpMedia && url.startsWith("http://"))),
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
