export type EditorDraft = {
  html: string;
  mode: "rich" | "html";
  savedAt: string;
};

export function editorDraftStorageKey(autosaveKey: string): string {
  return `edm:editor:${autosaveKey}`;
}

export function readEditorDraft(autosaveKey: string): EditorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(editorDraftStorageKey(autosaveKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorDraft;
    if (
      typeof parsed?.html !== "string" ||
      (parsed.mode !== "rich" && parsed.mode !== "html") ||
      typeof parsed.savedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeEditorDraft(autosaveKey: string, draft: EditorDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(editorDraftStorageKey(autosaveKey), JSON.stringify(draft));
}

export function clearEditorDraft(autosaveKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(editorDraftStorageKey(autosaveKey));
}
