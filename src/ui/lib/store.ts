import { create } from "zustand";
import type {
  AspectRatio, ConfigStatus, ExportPreset, GenerateRequest, HistoryEntry,
  ModelSpec, RefImage, SavedWorkflow, SizeTier,
} from "../../shared/types.js";
import { api, generate, type Bootstrap, type StreamEvent } from "./api.js";

export type FrameStatus = "waiting" | "rendering" | "done" | "failed";

/** One variant's slot on the sheet, from empty stock to finished proof. */
export interface Frame {
  index: number;
  status: FrameStatus;
  /** Latest streamed preview, as a data URL. */
  partial?: string;
  url?: string;
  id?: string;
  message?: string;
  error?: string;
}

/** A finished run kept below the sheet — the take you compare against. */
export interface Take {
  jobId: string;
  at: number;
  concept: string;
  urls: string[];
}

interface State {
  ready: boolean;
  bootError?: string;
  models: ModelSpec[];
  presets: ExportPreset[];
  config: ConfigStatus;
  defaultStyleRules: string;
  home: string;

  // Docket fields.
  concept: string;
  title: string;
  styleRules: string;
  useCustomRules: boolean;
  model: string;
  aspect: AspectRatio;
  size: SizeTier;
  variants: number;
  refs: RefImage[];

  // Run state.
  running: boolean;
  jobId?: string;
  frames: Frame[];
  runError?: string;
  lastCost?: number;
  /** Set once the concept is edited after a render — the sheet stamps REVISED. */
  revised: boolean;
  takes: Take[];

  history: HistoryEntry[];
  workflows: SavedWorkflow[];
  /** Frames signed off as keepers, by image id. Survives route changes. */
  keptIds: string[];
  /** Bumped whenever the sheet is rebuilt, so orphaned writes can be dropped. */
  sheetVersion: number;

  boot: () => Promise<void>;
  set: <K extends keyof State>(key: K, value: State[K]) => void;
  patchDocket: (patch: Partial<Pick<State,
    "concept" | "title" | "styleRules" | "useCustomRules" | "model" |
    "aspect" | "size" | "variants" | "refs">>) => void;
  run: () => Promise<void>;
  /** Reprints a single frame, leaving the rest of the sheet intact. */
  runFrame: (index: number) => Promise<void>;
  stop: () => void;
  toggleKept: (id: string) => void;
  openTake: (jobId: string) => void;
  loadHistory: () => Promise<void>;
  restore: (entry: HistoryEntry) => void;
  loadWorkflows: () => Promise<void>;
  saveWorkflow: (name: string) => Promise<void>;
  applyWorkflow: (id: string) => void;
  removeWorkflow: (id: string) => Promise<void>;
  modelSpec: () => ModelSpec | undefined;
}

let controller: AbortController | null = null;
/** One per in-flight single-frame reprint. */
const frameControllers = new Map<number, AbortController>();

export const useStore = create<State>((set, get) => ({
  ready: false,
  models: [],
  presets: [],
  config: { gemini: { configured: false }, openai: { configured: false } },
  defaultStyleRules: "",
  home: "",

  concept: "",
  title: "",
  styleRules: "",
  useCustomRules: false,
  model: "gemini-3-pro-image",
  aspect: "16:9",
  size: "2K",
  variants: 2,
  refs: [],

  running: false,
  frames: [],
  revised: false,
  takes: [],
  history: [],
  workflows: [],
  keptIds: [],
  sheetVersion: 0,

  async boot() {
    try {
      const data: Bootstrap = await api.bootstrap();
      const prefs = data.prefs as Partial<GenerateRequest> & { useCustomRules?: boolean };
      set({
        ready: true,
        models: data.models,
        presets: data.presets,
        config: data.config,
        defaultStyleRules: data.defaultStyleRules,
        home: data.home,
        // Prefs remember the last job's setup, so the next session opens
        // where the previous one left off.
        model: prefs.model ?? "gemini-3-pro-image",
        aspect: (prefs.aspect as AspectRatio) ?? "16:9",
        size: (prefs.size as SizeTier) ?? "2K",
        variants: prefs.variants ?? 2,
        styleRules: prefs.styleRules ?? data.defaultStyleRules,
        useCustomRules: prefs.useCustomRules ?? false,
      });
    } catch (err) {
      set({ ready: true, bootError: (err as Error).message });
    }
  },

  set: (key, value) => set({ [key]: value } as Pick<State, typeof key>),

  patchDocket(patch) {
    const before = get();
    set(patch as Partial<State>);
    // Editing the concept after a render is what marks the sheet revised.
    if (patch.concept !== undefined && before.takes.length && patch.concept !== before.concept) {
      set({ revised: true });
    }
  },

  modelSpec: () => get().models.find((m) => m.id === get().model),

  async run() {
    const s = get();
    if (s.running) return;

    // A reprint still streaming belongs to the sheet we are about to replace.
    for (const [, c] of frameControllers) c.abort();
    frameControllers.clear();

    controller = new AbortController();
    const variants = s.variants;

    set({
      running: true,
      sheetVersion: s.sheetVersion + 1,
      runError: undefined,
      revised: false,
      frames: Array.from({ length: variants }, (_, index) => ({
        index,
        status: "waiting" as FrameStatus,
      })),
    });

    const request: GenerateRequest = {
      model: s.model,
      concept: s.concept,
      title: s.title || undefined,
      styleRules: s.useCustomRules ? s.styleRules : undefined,
      aspect: s.aspect,
      size: s.size,
      variants,
      refs: s.refs,
    };

    const patchFrame = (index: number, patch: Partial<Frame>) =>
      set((state) => ({
        frames: state.frames.map((f) => (f.index === index ? { ...f, ...patch } : f)),
      }));

    try {
      await generate(request, (event: StreamEvent) => {
        switch (event.type) {
          case "start":
            set({ jobId: event.jobId });
            break;
          case "status":
            patchFrame(event.index, { status: "rendering", message: event.message });
            break;
          case "partial":
            patchFrame(event.index, {
              status: "rendering",
              partial: `data:${event.mimeType};base64,${event.data}`,
            });
            break;
          case "image":
            patchFrame(event.index, {
              status: "done", url: event.url, id: event.id, partial: undefined,
            });
            break;
          case "error":
            if (event.index === undefined) set({ runError: event.message });
            else patchFrame(event.index, { status: "failed", error: event.message });
            break;
          case "done": {
            set({ lastCost: event.usage?.estimatedCost });
            const done = get().frames.filter((f) => f.url);
            if (done.length) {
              set((state) => ({
                takes: [
                  { jobId: event.jobId, at: Date.now(), concept: state.concept,
                    urls: done.map((f) => f.url!) },
                  ...state.takes,
                ].slice(0, 8),
              }));
            }
            break;
          }
        }
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        set({ runError: (err as Error).message });
      }
    } finally {
      set({ running: false });
      controller = null;
      void api.savePrefs({
        model: get().model, aspect: get().aspect, size: get().size,
        variants: get().variants, styleRules: get().styleRules,
        useCustomRules: get().useCustomRules,
      });
      void get().loadHistory();
    }
  },

  async runFrame(index) {
    const s = get();
    if (s.running || frameControllers.has(index)) return;

    const sheet = s.sheetVersion;
    const controllerForFrame = new AbortController();
    frameControllers.set(index, controllerForFrame);

    set((state) => ({
      frames: state.frames.map((f) =>
        f.index === index
          ? { ...f, status: "rendering", error: undefined, partial: undefined, url: undefined }
          : f),
    }));

    const request: GenerateRequest = {
      model: s.model,
      concept: s.concept,
      title: s.title || undefined,
      styleRules: s.useCustomRules ? s.styleRules : undefined,
      aspect: s.aspect,
      size: s.size,
      variants: 1,
      refs: s.refs,
    };

    const patch = (p: Partial<Frame>) =>
      set((state) =>
        // The sheet moved on; this reprint's output belongs to a run the user
        // has already replaced.
        state.sheetVersion !== sheet
          ? {}
          : { frames: state.frames.map((f) => (f.index === index ? { ...f, ...p } : f)) });

    try {
      // The single-variant run reports itself as index 0; land it on the
      // frame the user actually asked to reprint.
      await generate(request, (event) => {
        switch (event.type) {
          case "status": patch({ status: "rendering", message: event.message }); break;
          case "partial":
            patch({ status: "rendering", partial: `data:${event.mimeType};base64,${event.data}` });
            break;
          case "image":
            patch({ status: "done", url: event.url, id: event.id, partial: undefined });
            break;
          case "error":
            patch({ status: "failed", error: event.message });
            break;
        }
      }, controllerForFrame.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patch({ status: "failed", error: (err as Error).message });
      }
    } finally {
      frameControllers.delete(index);
      void get().loadHistory();
    }
  },

  stop() {
    controller?.abort();
    controller = null;
    for (const [, c] of frameControllers) c.abort();
    frameControllers.clear();
    set({ running: false });
  },

  toggleKept(id) {
    set((state) => ({
      keptIds: state.keptIds.includes(id)
        ? state.keptIds.filter((k) => k !== id)
        : [...state.keptIds, id],
    }));
    // A signed-off frame marks its job in the file, so the decision outlives
    // the session rather than only the route.
    const jobId = id.slice(0, id.lastIndexOf("-"));
    const kept = get().keptIds.includes(id);
    if (jobId) void api.favorite(jobId, kept).catch(() => {});
  },

  openTake(jobId) {
    const take = get().takes.find((t) => t.jobId === jobId);
    if (!take) return;
    set({
      frames: take.urls.map((url, index) => ({
        index,
        status: "done" as FrameStatus,
        url,
        id: `${take.jobId}-${index}`,
      })),
      jobId: take.jobId,
      revised: false,
      sheetVersion: get().sheetVersion + 1,
    });
  },

  async loadWorkflows() {
    try {
      set({ workflows: (await api.workflows()).workflows });
    } catch { /* workflows are non-critical */ }
  },

  async saveWorkflow(name) {
    const s = get();
    await api.saveWorkflow({
      name,
      form: {
        concept: s.concept, title: s.title, model: s.model, aspect: s.aspect,
        size: s.size, variants: s.variants,
        styleRules: s.useCustomRules ? s.styleRules : undefined,
      },
    });
    await get().loadWorkflows();
  },

  applyWorkflow(id) {
    const wf = get().workflows.find((w) => w.id === id);
    if (!wf) return;
    const f = wf.form;
    set({
      concept: f.concept ?? "",
      title: f.title ?? "",
      model: f.model ?? get().model,
      aspect: (f.aspect as AspectRatio) ?? get().aspect,
      size: (f.size as SizeTier) ?? get().size,
      variants: f.variants ?? get().variants,
      styleRules: f.styleRules ?? get().defaultStyleRules,
      useCustomRules: Boolean(f.styleRules),
    });
  },

  async removeWorkflow(id) {
    await api.deleteWorkflow(id);
    await get().loadWorkflows();
  },

  async loadHistory() {
    try {
      set({ history: (await api.history()).entries });
    } catch { /* history is non-critical */ }
  },

  restore(entry) {
    set({
      concept: entry.request.concept,
      title: entry.request.title ?? "",
      model: entry.request.model,
      aspect: entry.request.aspect,
      size: entry.request.size,
      variants: entry.request.variants,
      styleRules: entry.request.styleRules ?? get().defaultStyleRules,
      useCustomRules: Boolean(entry.request.styleRules),
      frames: entry.images.map((img, index) => ({
        index,
        status: "done" as FrameStatus,
        url: `/api/image/${entry.id}/${img.file}`,
        id: img.id,
      })),
      revised: false,
      sheetVersion: get().sheetVersion + 1,
    });
  },
}));
