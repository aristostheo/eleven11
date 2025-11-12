
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import * as Localization from "expo-localization";
import { canPostCallable, submitPostCallable } from "../src/lib/firebase";

export default function Compose() {
  const [caption, setCaption] = useState("");
  const tzId = Localization.getCalendars()[0]?.timeZone || "UTC";

  const onSubmit = async () => {
    try {
      const can = await canPostCallable({ tzId, clientNow: Date.now() });
      if (!can.data.allowed) {
        Alert.alert("Not allowed", can.data.reason || "Try again at 11:11");
        return;
      }
      const res = await submitPostCallable({ tzId, caption, media: { type: "none" } });
      Alert.alert("Posted!", `id: ${res.data.postId}`);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <View style={{ flex:1, padding:20, gap:12 }}>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>Today's prompt</Text>
      <Text style={{ color:"#666" }}>Share one curious thing about now.</Text>
      <TextInput value={caption} onChangeText={setCaption} placeholder="Your 280‑char thought"
        style={{ borderWidth:1, borderColor:"#ddd", borderRadius:12, padding:12, minHeight:120 }}/>
      <Pressable onPress={onSubmit} style={{ backgroundColor:"black", padding:14, borderRadius:12, alignItems:"center" }}>
        <Text style={{ color:"white" }}>Submit</Text>
      </Pressable>
    </View>
  );
}
