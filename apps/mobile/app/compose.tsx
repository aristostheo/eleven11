// apps/mobile/app/compose.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Localization from "expo-localization";
import { DateTime } from "luxon";
import Svg, { Circle } from "react-native-svg";
import { canPost, submitPost, ensureAuth, uploadPhoto, deleteUploadedPhoto } from "../src/lib/firebase";
import { useServerClock } from "../src/utils/useServerClock";

import { postingWindow, WINDOW_SECONDS } from "../src/utils/time";
import { emulatorWindowStartMillis } from "../src/utils/emulator";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const MAX_CHARS = 280;
type CanPostData = { allowed: boolean; reason: string | null; dayKey?: string };
type SubmitData = { postId: string };

/** Clearer error helper */
const showFnError = (err: any, fallback = "Action failed") => {
  // Helpful mapping for common Firebase callable codes
  const rawCode = err?.code || err?.name || err?.error?.code || "unknown-error";
  const code = String(rawCode).toLowerCase().replace(/^functions\//, "");

  const map: Record<string, string> = {
    "functions/unauthenticated":
      "You must be signed in. We’ll sign you in silently—try again.",
    unauthenticated:
      "You must be signed in. We’ll sign you in silently—try again.",
    "failed-precondition":
      "Not in the allowed time window. Try again at 11:11.",
    "already-exists": "You already posted today.",
    "permission-denied":
      "You don’t have permission to do that. Check Firestore/Functions rules.",
    "not-found": "Callable function not found. Make sure it’s deployed.",
  };

  const nice = map[code] || fallback;
  const msg =
    err?.message ||
    err?.error?.message ||
    (typeof err === "string" ? err : JSON.stringify(err));

  console.log("[FN ERROR]", err);
  Alert.alert(nice, msg);
};

export default function Compose() {
  const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const { serverNow } = useServerClock();

  const [caption, setCaption] = useState("");
  const [img, setImg] = useState<{
    uri: string;
    w?: number;
    h?: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [windowLeft, setWindowLeft] = useState<string>("—");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  const cardIn = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  const ringSize = 80;
  const R = (ringSize - 8) / 2;

  useEffect(() => {
    Animated.timing(cardIn, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Keep countdown + permission fresh
  const tick = async () => {
    const nowMillis = serverNow();
    if (nowMillis === null) {
      setWindowLeft("Syncing…");
      return;
    }
    const now = DateTime.fromMillis(nowMillis).setZone(tzId);
    const { start, end, open } = postingWindow(now, emulatorWindowStartMillis);

    if (open) {
      const left = end.diff(now, ["seconds"]).seconds ?? 0;
      setWindowLeft(`${Math.max(0, Math.floor(left))}s left`);
      const pct = Math.max(0, Math.min(1, left / WINDOW_SECONDS));
      Animated.timing(progress, {
        toValue: pct,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      const next = start;
      const d = next.diff(now, ["hours", "minutes", "seconds"]).toObject();
      setWindowLeft(
        `${d.hours || 0}h ${d.minutes || 0}m ${Math.floor(d.seconds || 0)}s`
      );
      Animated.timing(progress, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }

  };

  useEffect(() => {
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tzId, serverNow]);

  useEffect(() => {
    let active = true;
    let checking = false;
    const checkPermission = async () => {
      if (checking) return;
      const nowMillis = serverNow();
      if (nowMillis === null) {
        setAllowed(false);
        setReason("Connecting to the server clock…");
        return;
      }
      if (!postingWindow(DateTime.fromMillis(nowMillis).setZone(tzId), emulatorWindowStartMillis).open) {
        setAllowed(false);
        setReason("Posting opens at 11:11 AM and PM.");
        return;
      }
      checking = true;
      try {
        await ensureAuth();
        const { data } = await canPost({ tzId, clientNow: Date.now() }) as { data: CanPostData };
        if (active) {
          setAllowed(data.allowed);
          setReason(data.reason === "already-posted" ? "You already posted today."
            : data.reason === "outside-window" ? "Outside the 11:11 window." : data.reason);
        }
      } catch {
        if (active) {
          setAllowed(false);
          setReason("Cannot connect. Check your connection and Firebase setup.");
        }
      } finally {
        checking = false;
      }
    };
    checkPermission();
    const id = setInterval(checkPermission, 5000);
    return () => { active = false; clearInterval(id); };
  }, [tzId, serverNow]);

  const charCount = caption.trim().length;
  const remaining = MAX_CHARS - charCount;
  const over = remaining < 0;

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow photo access to attach an image."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
      aspect: [4, 3],
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setImg({ uri: asset.uri, w: asset.width, h: asset.height });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const clearImage = () => {
    setImg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const onSubmit = async () => {
    if (submitting) return;

    if (!allowed) {
      Alert.alert("Not allowed", reason ?? "Outside the 11:11 window.");
      return;
    }
    if (over || charCount === 0) {
      Alert.alert(
        "Hold up",
        over ? "Too many characters." : "Write something first."
      );
      return;
    }

    let uploadedUrl: string | null = null;
    let posted = false;
    let safeToDeleteUpload = true;
    try {
      setSubmitting(true);
      await ensureAuth(); // just in case
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (img) uploadedUrl = await uploadPhoto(img.uri);
      const payload: any = {
        tzId,
        caption: caption.trim(),
        media: img
          ? { type: "image", url: uploadedUrl, w: img.w, h: img.h }
          : { type: "none" },
      };
      // A lost response may still mean the post was committed. Preserve the image
      // unless the backend definitively rejected the submission.
      safeToDeleteUpload = false;
      const res = (await submitPost(payload)) as unknown as {
        data: SubmitData;
      };
      posted = true;
      const id = res?.data?.postId ?? "—";
      Alert.alert("Posted ✨", `Your wish is live.\nID: ${id}`);
      setCaption("");
      setImg(null);
      router.back();
    } catch (e) {
      const code = String((e as { code?: string })?.code ?? "").replace(/^functions\//, "");
      if (["already-exists", "failed-precondition", "invalid-argument", "unauthenticated"].includes(code)) {
        safeToDeleteUpload = true;
      }
      showFnError(e, "Failed to post");
    } finally {
      if (uploadedUrl && !posted && safeToDeleteUpload) {
        try { await deleteUploadedPhoto(uploadedUrl); }
        catch (cleanupError) { console.warn("Could not clean up unused photo", cleanupError); }
      }
      setSubmitting(false);
    }
  };

  const scaleIn = cardIn.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });
  const fadeIn = cardIn;
  const btnScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const btnShadow = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 16],
  });
  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [2 * Math.PI * R, 0],
  });

  const canSubmit = !!allowed && !over && charCount > 0 && !submitting;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Background */}
      <LinearGradient
        colors={["#0a0814", "#1b0f3d", "#3a1f7a"]}
        start={{ x: 0.1, y: 0.0 }}
        end={{ x: 0.9, y: 1.0 }}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Top bar / timer */}
      <View
        style={{
          paddingTop: 56,
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => router.back()} style={{ padding: 10 }}>
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>
            ← Back
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 80, height: 80 }}>
            <Svg width={80} height={80}>
              <Circle
                cx={40}
                cy={40}
                r={(80 - 8) / 2}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={6}
                fill="none"
              />
              <AnimatedCircle
                cx={40}
                cy={40}
                r={(80 - 8) / 2}
                stroke={allowed ? "#A67CFF" : "rgba(255,255,255,0.6)"}
                strokeWidth={6}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${2 * Math.PI * R} ${2 * Math.PI * R}`}
                // Animated value
                strokeDashoffset={strokeDashoffset}
              />
            </Svg>
          </View>
          <View>
            <Text style={{ color: "white", fontWeight: "700" }}>
              11:11 Window
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.8)" }}>
              {allowed ? windowLeft : "Locked"}
            </Text>
          </View>
        </View>
      </View>

      {/* Card */}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Animated.View
          style={{
            opacity: fadeIn,
            transform: [{ scale: scaleIn }],
            backgroundColor: "rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.15)",
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 18,
          }}
        >
          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "800",
              marginBottom: 8,
            }}
          >
            Make your wish ✨
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>
            {Localization.getCalendars()[0]?.timeZone || tzId}
          </Text>

          {/* Input */}
          <View
            style={{
              backgroundColor: "rgba(0,0,0,0.2)",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.15)",
              padding: 12,
            }}
          >
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Your 280-char thought…"
              placeholderTextColor="rgba(255,255,255,0.5)"
              multiline
              maxLength={MAX_CHARS * 2}
              style={{
                color: "white",
                minHeight: 120,
                fontSize: 16,
                lineHeight: 22,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <Text
                style={{ color: over ? "#ff9aa2" : "rgba(255,255,255,0.7)" }}
              >
                {over ? `Too long by ${-remaining}` : `${remaining} left`}
              </Text>
              <Pressable
                onPress={() => setCaption("")}
                style={{ paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ color: "rgba(255,255,255,0.8)" }}>Clear</Text>
              </Pressable>
            </View>
          </View>

          {/* Image attach */}
          <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
            {!img ? (
              <Pressable
                onPress={pickImage}
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.15)",
                }}
              >
                <Text style={{ color: "white", fontWeight: "600" }}>
                  ＋ Add Photo
                </Text>
              </Pressable>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: "rgba(255,255,255,0.12)",
                  padding: 8,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.15)",
                }}
              >
                <Image
                  source={{ uri: img.uri }}
                  style={{ width: 90, height: 90, borderRadius: 10 }}
                />
                <Pressable
                  onPress={clearImage}
                  style={{ paddingHorizontal: 10, paddingVertical: 8 }}
                >
                  <Text style={{ color: "#ff9aa2", fontWeight: "700" }}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Reason / lock banner */}
          {allowed === false && (
            <View
              style={{
                marginTop: 14,
                backgroundColor: "rgba(255,170,170,0.12)",
                borderColor: "rgba(255,170,170,0.25)",
                borderWidth: 1,
                padding: 10,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: "#ffb3b3" }}>
                {reason ?? "Outside the window or already posted today."}
              </Text>
            </View>
          )}

          {/* Submit */}
          <Animated.View
            style={{
              marginTop: 18,
              transform: [{ scale: canSubmit ? btnScale : 1 }],
              shadowColor: "#A67CFF",
              shadowOpacity: canSubmit ? 0.6 : 0.2,
              shadowRadius: canSubmit ? (btnShadow as unknown as number) : 6,
            }}
          >
            <Pressable
              disabled={!canSubmit}
              onPress={onSubmit}
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: canSubmit ? "white" : "rgba(255,255,255,0.2)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.2)",
              }}
            >
              <Text
                style={{
                  color: canSubmit ? "#0a0814" : "rgba(255,255,255,0.6)",
                  fontWeight: "800",
                  fontSize: 16,
                }}
              >
                {submitting ? "Posting…" : allowed ? "Post my wish" : "Locked"}
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
