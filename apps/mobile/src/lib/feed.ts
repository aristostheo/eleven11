import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { DateTime } from "luxon";
import { firestore } from "./firebase";

export const DAILY_FEED_PAGE_SIZE = 10;

export type Wish = {
  id: string;
  caption: string;
  createdAtMillis: number;
  media: { type: "none" } | { type: "image"; url: string; w?: number; h?: number };
};

/** A global calendar date derived from the server clock, not an author's zone. */
export function feedDayKey(millis: number) {
  return DateTime.fromMillis(millis).toUTC().toISODate();
}

function feedDayRange(dateKey: string) {
  const start = DateTime.fromISO(dateKey, { zone: "UTC" }).startOf("day");
  return {
    start: Timestamp.fromMillis(start.toMillis()),
    end: Timestamp.fromMillis(start.plus({ days: 1 }).toMillis()),
  };
}

export type DailyFeedPage = {
  wishes: Wish[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

export async function loadDailyFeed(
  dateKey: string,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
): Promise<DailyFeedPage> {
  const range = feedDayRange(dateKey);
  const base = query(
    collection(firestore, "posts"),
    where("status", "==", "active"),
    where("createdAt", ">=", range.start),
    where("createdAt", "<", range.end),
    orderBy("createdAt", "desc"),
  );
  const pageQuery = cursor
    ? query(base, startAfter(cursor), limit(DAILY_FEED_PAGE_SIZE + 1))
    : query(base, limit(DAILY_FEED_PAGE_SIZE + 1));
  const snapshot = await getDocs(pageQuery);
  const docs = snapshot.docs.slice(0, DAILY_FEED_PAGE_SIZE);

  return {
    wishes: docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        caption: String(data.caption ?? ""),
        createdAtMillis: data.createdAt?.toMillis?.() ?? 0,
        media: data.media?.type === "image"
          ? { type: "image", url: String(data.media.url), w: data.media.w, h: data.media.h }
          : { type: "none" },
      };
    }),
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore: snapshot.docs.length > DAILY_FEED_PAGE_SIZE,
  };
}
