import { localDayRange } from "../utils/time";
import { getDailyWishes } from "./firebase";

export const DAILY_FEED_PAGE_SIZE = 10;
export type FeedCursor = { createdAtMillis: number; id: string } | null;
export type WishMedia = {
  type: "none" | "image";
  storagePath?: string;
  sharedUrl?: string;
  w?: number;
  h?: number;
};
export type Wish = {
  id: string;
  caption: string;
  createdAtMillis: number;
  media: WishMedia;
};

/** Calendar day used by this viewer's feed. */
export function feedDayKey(millis: number, tzId: string) {
  return localDayRange(tzId, millis).dayKey;
}

export type DailyFeedPage = { wishes: Wish[]; cursor: FeedCursor; hasMore: boolean };

/** The callable derives the server-backed local-day createdAt range. */
export async function loadDailyFeed(tzId: string, cursor?: FeedCursor): Promise<DailyFeedPage> {
  const { data } = await getDailyWishes({ tzId, cursor }) as { data: DailyFeedPage };
  return data;
}
