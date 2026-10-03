import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { LinearGradient } from "expo-linear-gradient";
import { feedDayKey, loadDailyFeed, type FeedCursor, type Wish, type WishMedia } from "../src/lib/feed";
import { getSharedPhotoDataUrl, reportWish, toggleSparkleReaction } from "../src/lib/firebase";
import { useServerClock } from "../src/utils/useServerClock";

export default function DailyFeed() {
  const { serverNow } = useServerClock();
  const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const now = serverNow();
  const dateKey = now === null ? null : feedDayKey(now, tzId);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [cursor, setCursor] = useState<FeedCursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reactingPostId, setReactingPostId] = useState<string | null>(null);
  const [reportingWish, setReportingWish] = useState<Wish | null>(null);
  const [reportReason, setReportReason] = useState<"spam" | "abuse" | "harassment" | "other">("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dateKey) return;
    setRefreshing(true);
    setError(null);
    try {
      const page = await loadDailyFeed(tzId);
      setWishes(page.wishes);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load wishes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey, tzId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!dateKey || !cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadDailyFeed(tzId, cursor);
      setWishes((current) => [...current, ...page.wishes]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more wishes.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, dateKey, hasMore, loadingMore, tzId]);

  const subtitle = useMemo(() => dateKey
    ? `Your daily feed · ${dateKey} · ${tzId}`
    : "Syncing with the server clock…", [dateKey, tzId]);

  const toggleReaction = useCallback(async (postId: string) => {
    if (reactingPostId) return;
    setReactingPostId(postId);
    try {
      const { data } = await toggleSparkleReaction(postId) as {
        data: { postId: string; reacted: boolean; count: number };
      };
      setWishes((current) => current.map((wish) => wish.id === data.postId
        ? { ...wish, reactions: { sparkle: data.count, viewerReacted: data.reacted } }
        : wish));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t update your reaction.");
    } finally {
      setReactingPostId(null);
    }
  }, [reactingPostId]);

  const submitReport = useCallback(async () => {
    if (!reportingWish || submittingReport) return;
    setSubmittingReport(true);
    try {
      await reportWish({ postId: reportingWish.id, reason: reportReason, details: reportDetails.trim() });
      setReportingWish(null);
      setReportDetails("");
      Alert.alert("Report submitted", "Thanks. A moderator can now review this wish.");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      Alert.alert("Couldn’t submit report", code === "functions/already-exists"
        ? "You already reported this wish."
        : "Please try again later.");
    } finally {
      setSubmittingReport(false);
    }
  }, [reportDetails, reportReason, reportingWish, submittingReport]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0814" }}>
      <LinearGradient
        colors={["#0a0814", "#1a1340", "#2a1670"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={{ position: "absolute", inset: 0 }}
      />
      <FlatList
        data={wishes}
        keyExtractor={(wish) => wish.id}
        contentContainerStyle={{ padding: 24, paddingTop: 64, flexGrow: 1, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="white" />}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>← Back</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/my-wishes")} hitSlop={12}>
              <Text style={{ color: "#d7c7ff", fontSize: 16, fontWeight: "700" }}>My wishes</Text>
            </Pressable>
            <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>Daily wishes</Text>
            <Text style={{ color: "rgba(255,255,255,0.68)" }}>{subtitle}</Text>
          </View>
        }
        renderItem={({ item }) => <WishCard
          wish={item}
          reacting={reactingPostId === item.id}
          onToggleReaction={toggleReaction}
          onReport={(wish) => { setReportingWish(wish); setReportReason("spam"); setReportDetails(""); }}
        />}
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 36, alignItems: "center", gap: 12 }}>
              <ActivityIndicator color="white" />
              <Text style={{ color: "rgba(255,255,255,0.78)" }}>Loading wishes…</Text>
            </View>
          ) : error ? (
            <StateCard message="We couldn’t load today’s wishes." action="Try again" onPress={() => void refresh()} />
          ) : (
            <StateCard message="No active wishes have been posted today yet." action="Refresh" onPress={() => void refresh()} />
          )
        }
        ListFooterComponent={
          wishes.length > 0 ? (
            <View style={{ paddingVertical: 16, alignItems: "center" }}>
              {error ? <StateCard message="Couldn’t load more wishes." action="Try again" onPress={() => void loadMore()} /> : null}
              {loadingMore ? <ActivityIndicator color="white" /> : null}
              {hasMore && !loadingMore ? (
                <Pressable onPress={() => void loadMore()} style={buttonStyle}>
                  <Text style={buttonTextStyle}>Load more wishes</Text>
                </Pressable>
              ) : null}
              {!hasMore && !loadingMore ? <Text style={{ color: "rgba(255,255,255,0.52)" }}>You’re all caught up.</Text> : null}
            </View>
          ) : null
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
      />
      <ReportModal
        wish={reportingWish}
        reason={reportReason}
        details={reportDetails}
        submitting={submittingReport}
        onChangeReason={setReportReason}
        onChangeDetails={setReportDetails}
        onClose={() => !submittingReport && setReportingWish(null)}
        onSubmit={() => void submitReport()}
      />
    </View>
  );
}

function WishCard({
  wish,
  reacting,
  onToggleReaction,
  onReport,
}: {
  wish: Wish;
  reacting: boolean;
  onToggleReaction: (postId: string) => void;
  onReport: (wish: Wish) => void;
}) {
  const postedAt = wish.createdAtMillis
    ? DateTime.fromMillis(wish.createdAtMillis).toLocal().toFormat("h:mm a")
    : "Just now";
  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 16, gap: 12 }}>
      <Text style={{ color: "white", fontSize: 17, lineHeight: 24 }}>{wish.caption}</Text>
      {wish.media.type === "image" ? <SharedWishImage postId={wish.id} media={wish.media} /> : null}
      <Text style={{ color: "rgba(255,255,255,0.58)", fontSize: 13 }}>Posted {postedAt}</Text>
      <Pressable
        onPress={() => void onToggleReaction(wish.id)}
        disabled={reacting}
        accessibilityRole="button"
        accessibilityLabel={wish.reactions.viewerReacted ? "Remove sparkle reaction" : "Add sparkle reaction"}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          gap: 7,
          alignItems: "center",
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: wish.reactions.viewerReacted ? "rgba(255,224,130,0.25)" : "rgba(255,255,255,0.1)",
          opacity: reacting ? 0.6 : 1,
        }}
      >
        <Text style={{ fontSize: 17 }}>✨</Text>
        <Text style={{ color: "white", fontWeight: "700" }}>{wish.reactions.sparkle}</Text>
      </Pressable>
      <Pressable onPress={() => onReport(wish)} accessibilityRole="button" accessibilityLabel="Report wish">
        <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700" }}>Report wish</Text>
      </Pressable>
    </View>
  );
}

function SharedWishImage({ postId, media }: { postId: string; media: WishMedia }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    setUri(null);
    if (!media.storagePath) return;
    void getSharedPhotoDataUrl(postId).then(setUri).catch(() => setUri(null));
  }, [postId, media.storagePath]);
  return uri ? <Image source={{ uri }} style={{ width: "100%", aspectRatio: 1, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" }} resizeMode="cover" /> : null;
}

function ReportModal({
  wish, reason, details, submitting, onChangeReason, onChangeDetails, onClose, onSubmit,
}: {
  wish: Wish | null;
  reason: "spam" | "abuse" | "harassment" | "other";
  details: string;
  submitting: boolean;
  onChangeReason: (reason: "spam" | "abuse" | "harassment" | "other") => void;
  onChangeDetails: (details: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const reasons: Array<[typeof reason, string]> = [["spam", "Spam"], ["abuse", "Abuse"], ["harassment", "Harassment"], ["other", "Other"]];
  return <Modal visible={wish !== null} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.6)" }}>
      <View style={{ backgroundColor: "#20183d", borderRadius: 22, padding: 20, gap: 14 }}>
        <Text style={{ color: "white", fontSize: 22, fontWeight: "800" }}>Report wish</Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>Choose a reason. Details are optional and visible only to moderators.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {reasons.map(([value, label]) => <Pressable key={value} onPress={() => onChangeReason(value)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: reason === value ? "rgba(166,124,255,0.45)" : "rgba(255,255,255,0.12)" }}><Text style={{ color: "white", fontWeight: "700" }}>{label}</Text></Pressable>)}
        </View>
        <TextInput value={details} onChangeText={onChangeDetails} editable={!submitting} multiline maxLength={500} placeholder="Optional details" placeholderTextColor="rgba(255,255,255,0.45)" style={{ minHeight: 82, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 14, padding: 12, color: "white", textAlignVertical: "top" }} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, alignItems: "center" }}>
          <Pressable onPress={onClose} disabled={submitting}><Text style={{ color: "rgba(255,255,255,0.72)", fontWeight: "700" }}>Cancel</Text></Pressable>
          <Pressable onPress={onSubmit} disabled={submitting} style={{ backgroundColor: "white", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, opacity: submitting ? 0.65 : 1 }}><Text style={{ color: "#0a0814", fontWeight: "800" }}>{submitting ? "Sending…" : "Send report"}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

function StateCard({ message, action, onPress }: { message: string; action: string; onPress: () => void }) {
  return (
    <View style={{ alignItems: "center", gap: 14, padding: 28, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20 }}>
      <Text style={{ color: "rgba(255,255,255,0.82)", textAlign: "center" }}>{message}</Text>
      <Pressable onPress={onPress} style={buttonStyle}><Text style={buttonTextStyle}>{action}</Text></Pressable>
    </View>
  );
}

const buttonStyle = { backgroundColor: "white", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11 } as const;
const buttonTextStyle = { color: "#0a0814", fontWeight: "800" } as const;
