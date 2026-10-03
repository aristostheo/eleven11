import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { decideModerationReport, getModerationReports, type ModerationReport } from "../src/lib/firebase";

export default function Moderation() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setReports(await getModerationReports());
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "functions/permission-denied" ? "Moderator access is required." : "Couldn’t load reports.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const decide = useCallback((report: ModerationReport, action: "dismiss" | "hide") => {
    const label = action === "hide" ? "Hide wish" : "Dismiss report";
    const message = action === "hide"
      ? "This removes the wish from the feed and disables app delivery of its image."
      : "This records the report as dismissed.";
    Alert.alert(label, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: action === "hide" ? "destructive" : "default", onPress: () => void (async () => {
        setActingId(report.id);
        try {
          await decideModerationReport(report.id, action);
          setReports((current) => current.filter((item) => item.id !== report.id));
        } catch {
          Alert.alert("Couldn’t save decision", "Refresh and try again.");
        } finally {
          setActingId(null);
        }
      })() },
    ]);
  }, []);

  return <View style={{ flex: 1, backgroundColor: "#0a0814" }}>
    <FlatList
      data={reports}
      keyExtractor={(report) => report.id}
      contentContainerStyle={{ padding: 24, paddingTop: 64, flexGrow: 1, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(); }} tintColor="white" />}
      ListHeaderComponent={<View style={{ gap: 8, marginBottom: 8 }}><Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>← Back</Text></Pressable><Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>Report review</Text><Text style={{ color: "rgba(255,255,255,0.68)", lineHeight: 20 }}>Moderator-only. Reporter identities and private moderation notes are not displayed.</Text></View>}
      renderItem={({ item }) => <ReportCard report={item} acting={actingId === item.id} onDecide={decide} />}
      ListEmptyComponent={loading ? <View style={{ padding: 36, alignItems: "center", gap: 12 }}><ActivityIndicator color="white" /><Text style={{ color: "rgba(255,255,255,0.78)" }}>Loading reports…</Text></View> : <View style={{ padding: 28, alignItems: "center", gap: 12 }}><Text style={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>{error ?? "No pending reports."}</Text>{error ? <Pressable onPress={() => { setLoading(true); void refresh(); }} style={button}><Text style={buttonText}>Try again</Text></Pressable> : null}</View>}
    />
  </View>;
}

function ReportCard({ report, acting, onDecide }: { report: ModerationReport; acting: boolean; onDecide: (report: ModerationReport, action: "dismiss" | "hide") => void }) {
  const date = report.createdAtMillis ? DateTime.fromMillis(report.createdAtMillis).toLocal().toFormat("ccc, LLL d · h:mm a") : "Unknown time";
  return <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 16, gap: 10 }}>
    <Text style={{ color: "white", fontSize: 17, lineHeight: 24 }}>{report.caption}</Text>
    <Text style={{ color: "#d7c7ff", fontWeight: "700" }}>Reason: {report.reason}</Text>
    {report.details ? <Text style={{ color: "rgba(255,255,255,0.78)", lineHeight: 20 }}>{report.details}</Text> : null}
    <Text style={{ color: "rgba(255,255,255,0.56)", fontSize: 13 }}>{date} · {report.hasImage ? "Photo" : "Text"} · {report.postStatus}</Text>
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Pressable disabled={acting} onPress={() => onDecide(report, "dismiss")} style={{ ...button, opacity: acting ? 0.6 : 1 }}><Text style={buttonText}>Dismiss</Text></Pressable>
      <Pressable disabled={acting} onPress={() => onDecide(report, "hide")} style={{ backgroundColor: "#b83e57", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11, opacity: acting ? 0.6 : 1 }}><Text style={{ color: "white", fontWeight: "800" }}>{acting ? "Saving…" : "Hide wish"}</Text></Pressable>
    </View>
  </View>;
}

const button = { backgroundColor: "white", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11 } as const;
const buttonText = { color: "#0a0814", fontWeight: "800" } as const;
