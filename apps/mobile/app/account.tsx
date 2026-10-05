import React, { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import {
  getIdentityStatus,
  saveAnonymousWishes,
  sendAccountRecovery,
  signInExistingAccount,
  signOutToAnonymous,
  type IdentityStatus,
} from "../src/lib/firebase";

export default function Account() {
  const [identity, setIdentity] = useState<IdentityStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await getIdentityStatus();
      setIdentity(status);
      if (status.email) setEmail(status.email);
    } catch {
      setNotice("Couldn’t load account status.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      const code = String((error as { code?: string })?.code ?? "");
      if (code.includes("email-already-in-use") || code.includes("credential-already-in-use")) {
        setNotice("That email already belongs to another account. Existing wish identities cannot be merged.");
      } else if (code.includes("wrong-password") || code.includes("invalid-credential")) {
        setNotice("That email or password is incorrect.");
      } else {
        setNotice(error instanceof Error ? error.message : "Account action failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const save = () => void run(async () => {
    await saveAnonymousWishes(email, password);
    setPassword("");
    setNotice("Your current wish identity is now saved with this email. Your UID and history stayed the same.");
  });

  const completeSignIn = (allowWishIdentityReplacement = false) => void run(async () => {
    const result = await signInExistingAccount(email, password, allowWishIdentityReplacement);
    if (result.requiresWarning) {
      Alert.alert(
        "Leave these wishes?",
        "This anonymous identity already has wishes. If you continue, this app will switch to the existing account after its credentials succeed. These unsaved wishes will no longer be recoverable through the app. This does not merge either identity.",
        [
          { text: "Keep my wishes", style: "cancel" },
          { text: "Leave and sign in", style: "destructive", onPress: () => completeSignIn(true) },
        ],
      );
      return;
    }
    setPassword("");
    setNotice("Signed in to the saved account.");
  });

  const reset = () => void run(async () => {
    await sendAccountRecovery(email);
    setNotice("If this saved account exists, Firebase sent a password-reset email.");
  });

  const signOut = () => Alert.alert("Sign out?", "You will return to a new anonymous identity. Your saved wishes remain with the account you are leaving.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => void run(async () => {
      await signOutToAnonymous();
      setPassword("");
      setNotice("Signed out. You are using a new anonymous identity.");
    }) },
  ]);

  const input = { color: "white", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1, borderRadius: 12, padding: 12 } as const;
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0a0814" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 16 }}>← Back</Text></Pressable>
      <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>Save my wishes</Text>
      <Text style={{ color: "rgba(255,255,255,0.72)", lineHeight: 21 }}>Email and password recovery is optional. Linking saves this exact Firebase identity, so its wishes and history stay attached to the same UID.</Text>
      {!identity ? <Text style={{ color: "rgba(255,255,255,0.7)" }}>Loading account…</Text> : identity.isAnonymous ? <>
        <View style={card}>
          <Text style={title}>Current anonymous identity</Text>
          <Text style={body}>{identity.hasWishes ? "This identity already has wishes. Create a new saved account to keep this exact history." : "This identity has no wishes yet. You may save it or sign into an existing account."}</Text>
        </View>
        <TextInput value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor="rgba(255,255,255,0.45)" style={input} />
        <TextInput value={password} onChangeText={setPassword} editable={!busy} secureTextEntry placeholder="Password (6+ characters)" placeholderTextColor="rgba(255,255,255,0.45)" style={input} />
        <Pressable disabled={busy || !email || password.length < 6} onPress={save} style={primary(busy || !email || password.length < 6)}><Text style={primaryText}>Save this identity</Text></Pressable>
        <Pressable disabled={busy || !email || password.length < 6} onPress={() => completeSignIn()} style={secondary(busy || !email || password.length < 6)}><Text style={secondaryText}>{identity.hasWishes ? "Leave and sign in" : "Sign in to existing account"}</Text></Pressable>
        <Pressable disabled={busy || !email} onPress={reset} style={secondary(busy || !email)}><Text style={secondaryText}>Send password reset</Text></Pressable>
      </> : <>
        <View style={card}>
          <Text style={title}>Saved account</Text>
          <Text style={body}>{identity.email ?? "Email hidden"}. Your wishes are still anonymous in Daily wishes.</Text>
        </View>
        <TextInput value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor="rgba(255,255,255,0.45)" style={input} />
        <Pressable disabled={busy || !email} onPress={reset} style={secondary(busy || !email)}><Text style={secondaryText}>Send password reset</Text></Pressable>
        <Pressable disabled={busy} onPress={signOut} style={danger(busy)}><Text style={{ color: "white", fontWeight: "800" }}>Sign out</Text></Pressable>
      </>}
      <View style={card}>
        <Text style={title}>Recovery and identity limits</Text>
        <Text style={body}>If you leave an unsaved anonymous identity, its wishes cannot be recovered through this app. A warning is required before switching to an existing account, and invalid credentials leave this identity in place. Signing in never merges two identities. Creating a new anonymous identity can still bypass a per-identity posting limit.</Text>
      </View>
      {notice ? <View style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: 14, borderRadius: 14 }}><Text style={{ color: "rgba(255,255,255,0.88)", lineHeight: 20 }}>{notice}</Text></View> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const card = { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 18, padding: 16, gap: 8 } as const;
const title = { color: "white", fontSize: 17, fontWeight: "800" } as const;
const body = { color: "rgba(255,255,255,0.72)", lineHeight: 20 } as const;
const primary = (disabled: boolean) => ({ backgroundColor: "white", borderRadius: 14, padding: 13, alignItems: "center" as const, opacity: disabled ? 0.55 : 1 });
const primaryText = { color: "#0a0814", fontWeight: "800" } as const;
const secondary = (disabled: boolean) => ({ borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", borderRadius: 14, padding: 13, alignItems: "center" as const, opacity: disabled ? 0.55 : 1 });
const secondaryText = { color: "white", fontWeight: "800" } as const;
const danger = (disabled: boolean) => ({ backgroundColor: "#b83e57", borderRadius: 14, padding: 13, alignItems: "center" as const, opacity: disabled ? 0.55 : 1 });
