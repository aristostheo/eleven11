import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

export type WishVisibility = "private" | "shared";
export type DraftPhoto = { uri: string; w?: number; h?: number };
export type WishDraft = {
  caption: string;
  visibility: WishVisibility;
  photo: DraftPhoto | null;
  updatedAt: number;
};

const draftKey = (uid: string) => `eleven11:draft:${uid}`;
const discardedKey = (uid: string) => `eleven11:draft-discarded:${uid}`;

export async function loadDraft(uid: string): Promise<WishDraft | null> {
  const [rawDraft, rawDiscarded] = await AsyncStorage.multiGet([draftKey(uid), discardedKey(uid)]);
  if (!rawDraft[1]) return null;
  try {
    const draft = JSON.parse(rawDraft[1]) as WishDraft;
    const discardedThrough = Number(rawDiscarded[1] ?? 0);
    if (!draft.updatedAt || draft.updatedAt <= discardedThrough) return null;
    if (draft.photo) {
      const info = await FileSystem.getInfoAsync(draft.photo.uri);
      if (!info.exists) draft.photo = null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function saveDraft(uid: string, draft: WishDraft) {
  await AsyncStorage.setItem(draftKey(uid), JSON.stringify(draft));
}

export async function clearDraft(uid: string, photo: DraftPhoto | null) {
  // The tombstone makes an older in-flight save ineligible for restoration.
  await AsyncStorage.setItem(discardedKey(uid), String(Date.now()));
  await AsyncStorage.removeItem(draftKey(uid));
  if (photo) await removeDraftPhoto(photo.uri);
}

export async function copyDraftPhoto(uid: string, sourceUri: string) {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error("Durable local files are unavailable on this device.");
  const directory = `${base}eleven11-drafts/${uid}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = sourceUri.match(/\.[a-zA-Z0-9]+(?:\?.*)?$/)?.[0]?.split("?")[0] ?? ".jpg";
  const uri = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  return uri;
}

export async function removeDraftPhoto(uri: string) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && uri.startsWith(FileSystem.documentDirectory ?? "")) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // Draft cleanup must not block a submission or explicit discard.
  }
}
