import { create } from "zustand";
import type { DedupStrategy, FieldMapping, ImportPreviewResult } from "@mailqivo/shared";

type ImportState = {
  step: number;
  preview: ImportPreviewResult | null;
  mapping: FieldMapping;
  dedupStrategy: DedupStrategy;
  tagIds: string[];
  setPreview: (preview: ImportPreviewResult) => void;
  setStep: (step: number) => void;
  setMapping: (mapping: FieldMapping) => void;
  setDedupStrategy: (strategy: DedupStrategy) => void;
  toggleTag: (id: string) => void;
  reset: () => void;
};

export const useImportStore = create<ImportState>((set) => ({
  step: 1,
  preview: null,
  mapping: {},
  dedupStrategy: "skip",
  tagIds: [],
  setPreview: (preview) => set({ preview, mapping: preview.field_mapping, step: 2 }),
  setStep: (step) => set({ step }),
  setMapping: (mapping) => set({ mapping }),
  setDedupStrategy: (dedupStrategy) => set({ dedupStrategy }),
  toggleTag: (id) => set((state) => ({
    tagIds: state.tagIds.includes(id) ? state.tagIds.filter((value) => value !== id) : [...state.tagIds, id]
  })),
  reset: () => set({ step: 1, preview: null, mapping: {}, dedupStrategy: "skip", tagIds: [] })
}));
