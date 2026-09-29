import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { LinearGradient } from "expo-linear-gradient";
import { feedDayKey, loadDailyFeed, type Wish } from "../src/lib/feed";
import { useServerClock } from "../src/utils/useServerClock";

export default function DailyFeed() {
  const { serverNow } = useServerClock();
  const now = serverNow();
  const dateKey = now === null ? null : feedDayKey(now);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [cursor, setCursor] = useState<Parameters<typeof loadDailyFeed>[1]>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dateKey) return;
    setRefreshing(true);
    setError(null);
    try {
      const page = await loadDailyFeed(dateKey);
      setWishes(page.wishes);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load wishes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!dateKey || !cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadDailyFeed(dateKey, cursor);
      setWishes((current) => [...current, ...page.wishes]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more wishes.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, dateKey, hasMore, loadingMore]);

  const subtitle = useMemo(() => dateKey
    ? `Worldwide daily feed · ${dateKey} UTC`
    : "Syncing with the server clock…", [dateKey]);

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
            <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>Daily wishes</Text>
            <Text style={{ color: "rgba(255,255,255,0.68)" }}>{subtitle}</Text>
          </View>
        }
        renderItem={({ item }) => <WishCard wish={item} />}
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
    </View>
  );
}

function WishCard({ wish }: { wish: Wish }) {
  const postedAt = wish.createdAtMillis
    ? DateTime.fromMillis(wish.createdAtMillis).toLocal().toFormat("h:mm a")
    : "Just now";
  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 16, gap: 12 }}>
      <Text style={{ color: "white", fontSize: 17, lineHeight: 24 }}>{wish.caption}</Text>
      {wish.media.type === "image" ? (
        <Image source={{ uri: wish.media.url }} style={{ width: "100%", aspectRatio: 1, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" }} resizeMode="cover" />
      ) : null}
      <Text style={{ color: "rgba(255,255,255,0.58)", fontSize: 13 }}>Posted {postedAt}</Text>
    </View>
  );
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
