
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import * as Localization from "expo-localization";
import { router } from "expo-router";
import { getServerTimeCallable, canPostCallable } from "../src/lib/firebase";
import { DateTime } from "luxon";

export default function Gate() {
  const tzId = Localization.getCalendars()[0]?.timeZone || "UTC";
  const [status, setStatus] = useState<"checking"|"locked"|"open">("checking");
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = DateTime.now().setZone(tzId);
      const start = now.set({ hour: 11, minute: 11, second: 0, millisecond: 0 });
      const end = start.plus({ seconds: 90 });
      if (now < start) {
        const diff = start.diff(now, ["hours","minutes","seconds"]).toObject();
        setStatus("locked");
        setCountdown(`${diff.hours || 0}h ${(diff.minutes||0)}m ${Math.floor(diff.seconds||0)}s`);
      } else if (now > end) {
        const next = start.plus({ days: 1 });
        const diff = next.diff(now, ["hours","minutes","seconds"]).toObject();
        setStatus("locked");
        setCountdown(`${diff.hours || 0}h ${(diff.minutes||0)}m ${Math.floor(diff.seconds||0)}s`);
      } else {
        setStatus("open");
        setCountdown("Now!");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tzId]);

  return (
    <View style={{ flex:1, alignItems:"center", justifyContent:"center", gap: 16 }}>
      <Text style={{ fontSize: 32, fontWeight: "700" }}>11:11</Text>
      <Text>{status === "open" ? "Make your wish ✨" : `Opens in ${countdown}`}</Text>
      {status === "open" && (
        <Pressable onPress={() => router.push("/compose")}
          style={{ paddingHorizontal:20, paddingVertical:12, borderRadius:12, backgroundColor:"black" }}>
          <Text style={{ color:"white" }}>Compose</Text>
        </Pressable>
      )}
    </View>
  );
}
