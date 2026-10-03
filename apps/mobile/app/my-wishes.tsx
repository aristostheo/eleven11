import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { getMyWishes, getPrivatePhotoDataUrl, getSharedPhotoDataUrl } from "../src/lib/firebase";
import type { FeedCursor, WishMedia } from "../src/lib/feed";

type JournalWish = {
  id: string;
  caption: string;
  createdAtMillis: number;
  visibility: "private" | "shared";
  status: "active" | "hidden";
  media: WishMedia;
};
type Page = { wishes: JournalWish[]; cursor: FeedCursor; hasMore: boolean };

export default function MyWishes() {
  const [wishes, setWishes] = useState<JournalWish[]>([]);
  const [cursor, setCursor] = useState<FeedCursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const { data } = await getMyWishes({}) as { data: Page };
      setWishes(data.wishes);
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your wishes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await getMyWishes({ cursor }) as { data: Page };
      setWishes((current) => [...current, ...data.wishes]);
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more wishes.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loadingMore]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0814" }}>
      <FlatList
        data={wishes}
        keyExtractor={(wish) => wish.id}
        contentContainerStyle={{ padding: 24, paddingTop: 64, flexGrow: 1, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="white" />}
        ListHeaderComponent={<View style={{ gap: 8, marginBottom: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>← Back</Text></Pressable>
          <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>My wishes</Text>
          <Text style={{ color: "rgba(255,255,255,0.68)" }}>Saved with this Firebase identity. Account recovery is not available yet.</Text>
        </View>}
        renderItem={({ item }) => <JournalCard wish={item} />}
        ListEmptyComponent={loading ? <Loading /> : error ? <State message="We couldn’t load your wishes." action="Try again" onPress={() => void refresh()} /> : <State message="You haven’t made a wish yet." action="Refresh" onPress={() => void refresh()} />}
        ListFooterComponent={wishes.length ? <View style={{ paddingVertical: 16, alignItems: "center", gap: 12 }}>
          {error ? <State message="Couldn’t load more wishes." action="Try again" onPress={() => void loadMore()} /> : null}
          {loadingMore ? <ActivityIndicator color="white" /> : null}
          {hasMore && !loadingMore ? <Pressable onPress={() => void loadMore()} style={button}><Text style={buttonText}>Load more wishes</Text></Pressable> : null}
          {!hasMore && !loadingMore ? <Text style={{ color: "rgba(255,255,255,0.52)" }}>You’re all caught up.</Text> : null}
        </View> : null}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

function JournalCard({ wish }: { wish: JournalWish }) {
  const date = DateTime.fromMillis(wish.createdAtMillis).toLocal().toFormat("ccc, LLL d · h:mm a");
  return <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 16, gap: 12 }}>
    <Text style={{ color: "white", fontSize: 17, lineHeight: 24 }}>{wish.caption}</Text>
    {wish.status === "hidden" ? <Text style={{ color: "#ffb6bd", lineHeight: 20 }}>Hidden by moderation. Only you can see this journal entry; its shared image is unavailable.</Text> : null}
    {wish.media.type === "image" && wish.status !== "hidden" ? <JournalImage postId={wish.id} media={wish.media} privateImage={wish.visibility === "private"} /> : null}
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: "rgba(255,255,255,0.58)", fontSize: 13 }}>{date}</Text>
      <Text style={{ color: wish.visibility === "private" ? "#d7c7ff" : "#9ee7c1", fontSize: 13, fontWeight: "700" }}>{wish.visibility === "private" ? "Only me" : "Shared anonymously"}</Text>
    </View>
  </View>;
}

function JournalImage({ postId, media, privateImage }: { postId: string; media: WishMedia; privateImage: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    setUri(null);
    if (!media.storagePath) return;
    const loader = privateImage ? getPrivatePhotoDataUrl(media.storagePath) : getSharedPhotoDataUrl(postId);
    void Promise.resolve(loader).then(setUri).catch(() => setUri(null));
  }, [postId, media.storagePath, privateImage]);
  return uri ? <Image source={{ uri }} style={{ width: "100%", aspectRatio: 1, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" }} resizeMode="cover" /> : <Text style={{ color: "rgba(255,255,255,0.56)" }}>Image unavailable</Text>;
}

function Loading() { return <View style={{ padding: 36, alignItems: "center", gap: 12 }}><ActivityIndicator color="white" /><Text style={{ color: "rgba(255,255,255,0.78)" }}>Loading your wishes…</Text></View>; }
function State({ message, action, onPress }: { message: string; action: string; onPress: () => void }) { return <View style={{ alignItems: "center", gap: 14, padding: 28, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20 }}><Text style={{ color: "rgba(255,255,255,0.82)", textAlign: "center" }}>{message}</Text><Pressable onPress={onPress} style={button}><Text style={buttonText}>{action}</Text></Pressable></View>; }
const button = { backgroundColor: "white", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11 } as const;
const buttonText = { color: "#0a0814", fontWeight: "800" } as const;
