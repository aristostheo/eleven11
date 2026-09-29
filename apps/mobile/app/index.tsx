// apps/mobile/app/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";
import { postingWindow, WINDOW_SECONDS } from "../src/utils/time";
import { useServerClock } from "../src/utils/useServerClock";
import { emulatorWindowStartMillis } from "../src/utils/emulator";

type GateState = "checking" | "locked" | "open";
const { width } = Dimensions.get("window");
const RING_SIZE = Math.min(width * 0.8, 320);
const R = (RING_SIZE - 14) / 2;
const CIRC = 2 * Math.PI * R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function Gate() {
  const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const { serverNow } = useServerClock();
  const [state, setState] = useState<GateState>("checking");
  const [countdownStr, setCountdownStr] = useState("—");
  const [nowStr, setNowStr] = useState("");

  const progress = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const stars = useMemo(() => {
    const count = 60;
    return Array.from({ length: count }).map((_, i) => ({
      key: `s${i}`,
      x: Math.random() * width,
      y: Math.random() * 720,
      r: Math.random() * 1.6 + 0.6,
      o: Math.random() * 0.7 + 0.2,
    }));
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const setRing = (pct: number) => {
    Animated.timing(progress, {
      toValue: pct,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const fmtCountdown = (d: ReturnType<DateTime["diff"]>) => {
    const { hours = 0, minutes = 0, seconds = 0 } = d.toObject();
    return `${Math.max(0, Math.floor(hours))}h ${Math.max(
      0,
      Math.floor(minutes)
    )}m ${Math.max(0, Math.floor(seconds))}s`;
  };
  const compute = () => {
    const nowMillis = serverNow();
    if (nowMillis === null) {
      setState("checking");
      setCountdownStr("—");
      setNowStr("—");
      return;
    }
    const now = DateTime.fromMillis(nowMillis).setZone(tzId);
    const { start, end, open } = postingWindow(now, emulatorWindowStartMillis);
    setNowStr(now.toFormat("HH:mm:ss"));
    setState(open ? "open" : "locked");
    setCountdownStr(open
      ? `${Math.ceil(end.diff(now, "seconds").seconds)}s left`
      : fmtCountdown(start.diff(now, ["hours", "minutes", "seconds"])));
    setRing(open ? end.diff(now, "seconds").seconds / WINDOW_SECONDS
      : Math.max(0, 1 - start.diff(now, "seconds").seconds / (12 * 3600)));

  };

  useEffect(() => {
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [tzId, serverNow]);

  useEffect(() => {
    if (state === "open")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [state]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRC, 0],
  });
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });
  const glowScale = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0814" }}>
      <LinearGradient
        colors={["#0a0814", "#1a1340", "#2a1670", "#7b2fb4"]}
        start={{ x: 0.2, y: 0.0 }}
        end={{ x: 0.8, y: 1.0 }}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <Svg
        width={width}
        height={720}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {stars.map((s) => (
          <Circle
            key={s.key}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="white"
            opacity={s.o}
          />
        ))}
      </Svg>

      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 20,
        }}
      >
        <Text
          style={{
            color: "white",
            opacity: 0.8,
            letterSpacing: 6,
            fontSize: 14,
          }}
        >
          TIME-GATED WISHES
        </Text>

        <View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg
            width={RING_SIZE}
            height={RING_SIZE}
            style={{ position: "absolute" }}
          >
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={R}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={10}
              fill="none"
            />
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={R}
              stroke="white"
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC} ${CIRC}`}
              strokeDashoffset={strokeDashoffset}
            />
          </Svg>

          <Animated.View
            style={{ alignItems: "center", transform: [{ scale: glowScale }] }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 56,
                fontWeight: "800",
                letterSpacing: 2,
              }}
            >
              11:11
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 4 }}>
              {nowStr}
            </Text>
          </Animated.View>
        </View>

        <Animated.Text
          style={{
            color: "white",
            fontSize: 18,
            opacity: glowOpacity as unknown as number,
            textAlign: "center",
          }}
        >
          {state === "checking" ? "Syncing with the 11:11 clock…" : state === "open" ? "Make your wish ✨" : `Opens in ${countdownStr}`}
        </Animated.Text>

        <Pressable
          onPress={() => router.push("/feed")}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 11,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.45)",
          }}
        >
          <Text style={{ color: "white", fontWeight: "700" }}>View daily wishes</Text>
        </Pressable>

        {state === "open" && (
          <Animated.View
            style={{
              transform: [{ scale: glowScale }],
              shadowColor: "#A67CFF",
              shadowOpacity: 0.6,
              shadowRadius: 20,
            }}
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push("/compose");
              }}
              style={{
                paddingHorizontal: 28,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: "white",
              }}
            >
              <Text
                style={{ color: "#0a0814", fontWeight: "700", fontSize: 16 }}
              >
                Compose
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </View>

      <View
        style={{
          position: "absolute",
          bottom: 22,
          width: "100%",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "rgba(255,255,255,0.6)" }}>
          {state === "checking" ? "Connect to check the posting window" : state === "open"
            ? `Window closes in ${countdownStr}`
            : "We’ll unlock right at 11:11"}
        </Text>
      </View>
      {__DEV__ && (
        <Pressable
          onPress={() => router.push("/compose")}
          style={{
            position: "absolute",
            // Keep the development shortcut above the status/footer copy.
            // Its previous bottom offset placed the button directly over the
            // "We’ll unlock right at 11:11" message on smaller iPhones.
            bottom: 84,
            right: 20,
            paddingVertical: 12,
            paddingHorizontal: 14,
            backgroundColor: "white",
            borderRadius: 14,
          }}
        >
          <Text style={{ fontWeight: "800", color: "#0a0814" }}>
            Preview compose
          </Text>
        </Pressable>
      )}
    </View>
  );
}
