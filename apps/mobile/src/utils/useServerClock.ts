import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getServerTime } from "../lib/firebase";

type Clock = { offset: number; syncedAt: number } | null;
let cachedClock: Clock = null;

export function useServerClock() {
  const [clock, setClock] = useState<Clock>(cachedClock);

  useEffect(() => {
    let active = true;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      const before = Date.now();
      try {
        const serverMillis = await getServerTime();
        const after = Date.now();
        // Midpoint limits the error caused by network round-trip time.
        const next = { offset: serverMillis - (before + after) / 2, syncedAt: after };
        cachedClock = next;
        if (active) setClock(next);
      } catch {
        // An old offset is only useful briefly; never unlock on stale time.
        if (active && (!cachedClock || Date.now() - cachedClock.syncedAt > 120_000)) {
          cachedClock = null;
          setClock(null);
        }
      } finally {
        pending = false;
      }
    };
    void sync();
    const interval = setInterval(() => void sync(), 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => { active = false; clearInterval(interval); subscription.remove(); };
  }, []);

  const serverNow = useCallback(() => clock && Date.now() - clock.syncedAt <= 120_000
    ? Date.now() + clock.offset : null, [clock]);
  return { serverNow };
}
