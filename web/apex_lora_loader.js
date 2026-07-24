import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  DEFAULT_SETTINGS,
  STRENGTH_DRAG_PIXELS_PER_TICK,
  addSection as addSectionToState,
  addTriggerWord,
  assignSectionColumns,
  allRows,
  applyFullPreset,
  applyPreset,
  createRow,
  createSection,
  formatStrength,
  insertionIndexFromMidpoints,
  fullPresetStateFromState,
  matchesFolderFilters,
  moveRow,
  moveSection,
  normalizeSettings,
  normalizeState,
  normalizeTriggerMetadata,
  normalizeTriggerPosition,
  parseStrengthInput,
  presetEntriesFromState,
  presetType,
  responsiveColumnCount,
  sectionColumn,
  sectionsByVisibleColumn,
  serializeState,
  removeTriggerWord,
  strengthFillParts,
  toggleTriggerWord,
  strengthFromDrag,
  toggleSectionRows,
} from "./state.js";
import { createSingleOwnerController } from "./overlay_controller.js";
import { previewDisplayName, previewSummary } from "./overlay_state.js";
import { activeLoraSignature, createAutoQueueController } from "./auto_queue.js";
import {
  addIgnoredIdentity,
  deriveSectionSyncStatus,
  markSectionSyncSeen,
  normalizeSectionSync,
  normalizeSectionSyncIdentity,
  planVerifiedSyncCandidates,
  reconcileIgnoredIdentities,
  recordSectionSyncExplicitAdditions,
  removeIgnoredIdentity,
  resetSectionSyncBaseline,
  sectionSyncFolderSelectionStates,
  sectionSyncFolderTree,
} from "./section_sync.js";

const NODE_CLASS = "ApexLoraLoader";
const DATA_WIDGET = "stack_data";
const DEFAULT_SIZE = [420, 250];
const PREVIEW_MIN_HEIGHT = 132;
const STATUS_MESSAGE_DURATION_MS = 5000;
const PRESET_JOBS_SUBMISSION_EVENT = "apex-preset-jobs/submission-state";
const NODE_TITLE_COLOR = "#181c23";
const NODE_BODY_COLOR = "#0f141a";
const SECTION_TOGGLE_ICON_STYLE = "chevrons";

const SECTION_TOGGLE_ICON_SETS = {
  chevrons: { collapsed: "chevronRight", expanded: "chevronDown" },
  listChevrons: { collapsed: "listChevronsUpDown", expanded: "listChevronsDownUp" },
};

let catalogCache = null;
let catalogRevision = 0;
let catalogFolderIndex = new Map();
let catalogLoadGeneration = 0;
let catalogLoadPromise = null;
let presetsCache = null;
let metadataCache = null;
let openPopover = null;
let dragPayload = null;
let editorView = null;
let openTriggerPreview = null;
let triggerPreviewSequence = 0;
let presetJobsSubmissionBusy = false;
let autoSyncPassQueue = Promise.resolve();

// Embedded Lucide SVG paths are ISC licensed; Feather-derived paths are MIT licensed.
// See ../THIRD_PARTY_NOTICES.md.
const ICONS = {
  trash: {
    className: "lucide-trash-2",
    nodes: [
      ["path", { d: "M10 11v6" }],
      ["path", { d: "M14 11v6" }],
      ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
    ],
  },
  x: {
    className: "lucide-x",
    nodes: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
  },
  listPlus: {
    className: "lucide-list-plus",
    nodes: [
      ["path", { d: "M16 5H3" }],
      ["path", { d: "M11 12H3" }],
      ["path", { d: "M16 19H3" }],
      ["path", { d: "M18 9v6" }],
      ["path", { d: "M21 12h-6" }],
    ],
  },
  listX: {
    className: "lucide-list-x",
    nodes: [
      ["path", { d: "M16 5H3" }],
      ["path", { d: "M11 12H3" }],
      ["path", { d: "M16 19H3" }],
      ["path", { d: "m15.5 9.5 5 5" }],
      ["path", { d: "m20.5 9.5-5 5" }],
    ],
  },
  listTodo: {
    className: "lucide-list-todo",
    nodes: [
      ["path", { d: "M13 5h8" }],
      ["path", { d: "M13 12h8" }],
      ["path", { d: "M13 19h8" }],
      ["path", { d: "m3 17 2 2 4-4" }],
      ["rect", { x: "3", y: "4", width: "6", height: "6", rx: "1" }],
    ],
  },
  externalLink: {
    className: "lucide-external-link",
    nodes: [
      ["path", { d: "M15 3h6v6" }],
      ["path", { d: "M10 14 21 3" }],
      ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
    ],
  },
  play: {
    className: "lucide-play",
    nodes: [
      ["path", { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }],
    ],
  },
  plus: {
    className: "lucide-plus",
    nodes: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "M12 5v14" }],
    ],
  },
  refresh: {
    className: "lucide-rotate-cw",
    nodes: [
      ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }],
    ],
  },
  folderCog: {
    className: "lucide-folder-cog",
    nodes: [
      ["path", { d: "M10.3 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.98a2 2 0 0 1 1.69.9l.66 1.2A2 2 0 0 0 12 6h8a2 2 0 0 1 2 2v3.3" }],
      ["path", { d: "m14.305 19.53.923-.382" }],
      ["path", { d: "m15.228 16.852-.923-.383" }],
      ["path", { d: "m16.852 15.228-.383-.923" }],
      ["path", { d: "m16.852 20.772-.383.924" }],
      ["path", { d: "m19.148 15.228.383-.923" }],
      ["path", { d: "m19.53 21.696-.382-.924" }],
      ["path", { d: "m20.772 16.852.924-.383" }],
      ["path", { d: "m20.772 19.148.924.383" }],
      ["circle", { cx: "18", cy: "18", r: "3" }],
    ],
  },
  folderSync: {
    className: "lucide-folder-sync",
    nodes: [
      ["path", { d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5" }],
      ["path", { d: "M12 10v4h4" }],
      ["path", { d: "m12 14 1.535-1.605a5 5 0 0 1 8 1.5" }],
      ["path", { d: "M22 22v-4h-4" }],
      ["path", { d: "m22 18-1.535 1.605a5 5 0 0 1-8-1.5" }],
    ],
  },
  pencil: {
    className: "lucide-pencil",
    nodes: [
      ["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
      ["path", { d: "m15 5 4 4" }],
    ],
  },
  settings: {
    className: "lucide-settings",
    nodes: [
      ["path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
  },
  savePlus: {
    className: "lucide-save-plus",
    nodes: [
      ["path", { d: "M12.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V12" }],
      ["path", { d: "M16 13H8a1 1 0 0 0-1 1v7" }],
      ["path", { d: "M19 22v-6" }],
      ["path", { d: "M22 19h-6" }],
      ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }],
    ],
  },
  tag: {
    className: "lucide-tag",
    nodes: [
      ["path", { d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" }],
      ["circle", { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor" }],
    ],
  },
  triangleAlert: {
    className: "lucide-triangle-alert",
    nodes: [
      ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
      ["path", { d: "M12 9v4" }],
      ["path", { d: "M12 17h.01" }],
    ],
  },
  chevronRight: {
    className: "lucide-chevron-right",
    nodes: [
      ["path", { d: "m9 18 6-6-6-6" }],
    ],
  },
  chevronDown: {
    className: "lucide-chevron-down",
    nodes: [
      ["path", { d: "m6 9 6 6 6-6" }],
    ],
  },
  listChevronsDownUp: {
    className: "lucide-list-chevrons-down-up",
    nodes: [
      ["path", { d: "M3 5h8" }],
      ["path", { d: "M3 12h8" }],
      ["path", { d: "M3 19h8" }],
      ["path", { d: "m15 5 3 3 3-3" }],
      ["path", { d: "m15 19 3-3 3 3" }],
    ],
  },
  listChevronsUpDown: {
    className: "lucide-list-chevrons-up-down",
    nodes: [
      ["path", { d: "M3 5h8" }],
      ["path", { d: "M3 12h8" }],
      ["path", { d: "M3 19h8" }],
      ["path", { d: "m15 8 3-3 3 3" }],
      ["path", { d: "m15 16 3 3 3-3" }],
    ],
  },
};

const editorController = createSingleOwnerController({
  mount: mountNodeEditor,
  render: renderEditor,
  unmount: unmountNodeEditor,
});


function editorAnchorIsActive(node, anchor) {
  return editorController.isOpenFor(node)
    && Boolean(anchor?.isConnected)
    && Boolean(editorView?.overlay?.contains(anchor));
}


function injectStyles() {
  for (const [attribute, filename] of [
    ["data-apex-lora-styles", "./apex_lora_loader.css"],
    ["data-apex-overlay-styles", "./apex_lora_overlay.css"],
  ]) {
    if (document.querySelector(`link[${attribute}]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(filename, import.meta.url).href;
    link.setAttribute(attribute, "true");
    document.head.appendChild(link);
  }
}


async function fetchJson(path, options = undefined) {
  const response = await api.fetchApi(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}


function buildCatalogFolderIndex(names) {
  const index = new Map();
  for (const name of Array.isArray(names) ? names : []) {
    const normalized = String(name).replaceAll("\\", "/");
    const separator = normalized.lastIndexOf("/");
    const folder = separator === -1 ? "" : normalized.slice(0, separator);
    const ancestors = [""];
    if (folder) {
      const parts = folder.split("/");
      for (let depth = 1; depth <= parts.length; depth += 1) {
        ancestors.push(parts.slice(0, depth).join("/"));
      }
    }
    for (const ancestor of ancestors) {
      if (!index.has(ancestor)) index.set(ancestor, []);
      index.get(ancestor).push(normalized);
    }
  }
  return index;
}


function catalogCandidatesForSectionSync(normalizedConfig) {
  const names = new Set();
  for (const folder of normalizedConfig?.include_folders || []) {
    for (const name of catalogFolderIndex.get(folder) || []) names.add(name);
  }
  return [...names];
}


async function loadCatalog(force = false) {
  if (!force && catalogCache !== null) return catalogCache;
  if (!force && catalogLoadPromise) return catalogLoadPromise;

  const generation = ++catalogLoadGeneration;
  const request = fetchJson("/apex_lora_loader/loras", { cache: "no-store" })
    .then((catalog) => {
      if (generation === catalogLoadGeneration) {
        catalogCache = catalog;
        catalogFolderIndex = buildCatalogFolderIndex(catalog.loras);
        catalogRevision += 1;
      }
      return catalog;
    });
  const tracked = request.finally(() => {
    if (generation === catalogLoadGeneration && catalogLoadPromise === tracked) {
      catalogLoadPromise = null;
    }
  });
  catalogLoadPromise = tracked;
  const catalog = await tracked;
  if (generation !== catalogLoadGeneration) {
    return catalogLoadPromise || catalogCache || catalog;
  }
  return catalog;
}


async function refreshCatalogFromComfy() {
  // ComfyUI has already refreshed its folder-path cache before invoking the
  // extension hook. Only reload Apex's lightweight filename/folder listing
  // here; identity hashing and rename verification belong to the Apex rescan.
  catalogCache = null;
  try {
    const catalog = await loadCatalog(true);
    refreshAllSectionSyncStatuses(catalog);
  } catch (error) {
    // Do not turn an otherwise successful native node-definition refresh into
    // a global failure. Leave the cache empty so the next chooser open retries.
    catalogCache = null;
    console.warn("[Apex LoRA Loader] Could not refresh the LoRA catalog.", error);
    return;
  }
  try {
    await queueAutoSyncPass(app.graph?._nodes || []);
  } catch (error) {
    console.warn("[Apex LoRA Loader] Automatic folder sync did not complete.", error);
  }
}


async function loadPresets(force = false) {
  if (force || presetsCache === null) {
    const data = await fetchJson("/apex_lora_loader/presets", { cache: "no-store" });
    presetsCache = Array.isArray(data.presets) ? data.presets : [];
  }
  return presetsCache;
}


async function loadMetadata(force = false) {
  if (force || metadataCache === null) {
    const data = await fetchJson("/apex_lora_loader/metadata");
    metadataCache = Array.isArray(data.entries) ? data.entries : [];
  }
  return metadataCache;
}


function dataWidget(node) {
  return node.widgets?.find((widget) => widget.name === DATA_WIDGET);
}


function invalidateSectionSync(node, clearErrors = false) {
  if (!node) return;
  node.__apexFolderSyncRevision = (node.__apexFolderSyncRevision || 0) + 1;
  node.__apexFolderSyncCache = null;
  if (clearErrors) node.__apexFolderSyncErrors = new Map();
}


function buildSectionSyncCache(node) {
  const sections = new Map();
  const signature = [];
  for (const section of node.__apexState?.sections || []) {
    const names = catalogCandidatesForSectionSync(section.folder_sync);
    const derived = deriveSectionSyncStatus(
      names,
      section.loras,
      section.folder_sync,
      node.__apexState.folder_filters,
    );
    const config = derived.config;
    const errors = node.__apexFolderSyncErrors?.get(section.id) || new Map();
    const actionableNames = new Set(derived.actionable);
    const status = {
      config: derived.config,
      actionable: derived.actionable,
      errors: new Map(
        [...errors].filter(([name]) => actionableNames.has(name)),
      ),
    };
    sections.set(section.id, status);
    signature.push([
      section.id,
      config.enabled,
      config.auto_sync,
      config.mode,
      derived.actionable,
      config.ignored.map((entry) => [entry.name, entry.sha256]),
    ]);
  }
  return {
    catalogRevision,
    stateRevision: node.__apexFolderSyncRevision || 0,
    sections,
    signature: JSON.stringify(signature),
  };
}


function folderSyncCache(node) {
  const cached = node.__apexFolderSyncCache;
  const stateRevision = node.__apexFolderSyncRevision || 0;
  if (
    cached
    && cached.catalogRevision === catalogRevision
    && cached.stateRevision === stateRevision
  ) {
    return cached;
  }
  const next = buildSectionSyncCache(node);
  node.__apexFolderSyncCache = next;
  return next;
}


function sectionSyncStatus(node, sectionId) {
  return folderSyncCache(node).sections.get(sectionId) || {
    config: normalizeSectionSync(),
    actionable: [],
    errors: new Map(),
  };
}


function refreshNodeSectionSyncStatus(node, render = true) {
  if (!node?.__apexState) return false;
  const previous = node.__apexFolderSyncCache?.signature || "";
  const next = folderSyncCache(node);
  const changed = previous !== next.signature;
  if (render && changed && node.__apexBuilt) renderNode(node);
  return changed;
}


function refreshAllSectionSyncStatuses() {
  for (const node of app.graph?._nodes || []) {
    if (node?.__apexState && node.__apexBuilt) refreshNodeSectionSyncStatus(node, true);
  }
  openPopover?.refresh?.();
}


function hideDataWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.type = "apex_hidden";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
  if (widget.inputEl) widget.inputEl.style.display = "none";
  if (widget.element) widget.element.style.display = "none";
}


function updateStatusElement(element, message = "", error = false) {
  if (!element) return;
  const idleLabel = element.dataset.idleLabel || "";
  const visibleMessage = message || idleLabel;
  const messageElement = element.__apexMessageElement || element;
  messageElement.textContent = visibleMessage;
  element.classList.toggle("idle", !message);
  element.classList.toggle("error", Boolean(message) && error);
  element.title = message || idleLabel;
}


function setStatus(node, message = "", error = false) {
  if (node.__apexStatusTimer != null) {
    clearTimeout(node.__apexStatusTimer);
    node.__apexStatusTimer = null;
  }
  const status = { message, error };
  node.__apexStatus = status;
  const elements = [
    node.__apexStatusElement,
    editorController.isOpenFor(node) ? editorView?.statusElement : null,
  ];
  for (const element of elements) {
    updateStatusElement(element, message, error);
  }
  const isProgress = typeof message === "string" && message.endsWith("…");
  if (message && !error && !isProgress) {
    node.__apexStatusTimer = setTimeout(() => {
      node.__apexStatusTimer = null;
      if (node.__apexStatus === status) setStatus(node, "");
    }, STATUS_MESSAGE_DURATION_MS);
  }
}


function editorQueueIsBlocked(view = editorView) {
  return presetJobsSubmissionBusy
    || view?.manualQueueBusy === true
    || view?.autoQueue?.state.inFlight === true;
}


function syncEditorQueueControls(node, autoState = null) {
  const view = editorView;
  if (!view || view.node !== node) return;
  const state = autoState || view.autoQueue?.state || {
    enabled: false,
    pending: false,
    inFlight: false,
    phase: "off",
  };
  const control = view.autoQueueControl;
  if (control) {
    control.classList.toggle("enabled", state.enabled);
    control.classList.toggle("pending", state.pending && !state.inFlight);
    control.classList.toggle("submitting", state.inFlight);
    control.classList.toggle("error", state.phase === "error");
    control.classList.toggle("waiting", state.phase === "waiting");
    control.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    const title = !state.enabled
      ? "Enable Run on change for LoRA states and committed strengths"
      : state.phase === "waiting"
        ? "Run on change is waiting for another Apex submission to finish"
        : state.inFlight
          ? "Run on change is submitting the current workflow"
          : "Run on change is enabled for LoRA states and committed strengths";
    control.title = title;
    control.setAttribute("aria-label", title);
  }

  if (!view.runButton) return;
  const blocked = editorQueueIsBlocked(view);
  view.runButton.disabled = blocked;
  view.runButton.title = presetJobsSubmissionBusy
    ? "Wait for Apex Preset Jobs to finish submitting"
    : view.manualQueueBusy
      ? "The current workflow is being queued"
      : state.inFlight
        ? "Run on change is queueing the current workflow"
        : "Queue the current workflow once";
}


function handleAutoQueueState(node, state) {
  syncEditorQueueControls(node, state);
  if (state.phase === "armed") {
    setStatus(node, "");
  } else if (state.phase === "scheduled") {
    setStatus(node, "Workflow update scheduled…");
  } else if (state.phase === "waiting") {
    setStatus(node, "Waiting for the active Apex submission…");
  } else if (state.phase === "submitting") {
    setStatus(node, "Queueing changed workflow…");
  } else if (state.phase === "queued") {
    setStatus(node, "Changed workflow queued.");
  } else if (state.phase === "error") {
    setStatus(node, state.error?.message || "Unable to queue the changed workflow.", true);
  }
}


function notifyEditorAutoQueue(node) {
  const view = editorView;
  if (!view || view.node !== node || !view.autoQueue?.state.enabled) return false;
  return view.autoQueue.notifyChange();
}


async function queueWorkflowFromEditor(node) {
  const view = editorView;
  if (!view || view.node !== node || editorQueueIsBlocked(view)) return false;
  view.autoQueue?.acknowledgeCurrent();
  view.manualQueueBusy = true;
  syncEditorQueueControls(node);
  setStatus(node, "Queueing workflow…");
  try {
    await app.queuePrompt(0, 1);
    setStatus(node, "Workflow queued.");
    return true;
  } catch (error) {
    setStatus(node, error?.message || "Unable to queue workflow.", true);
    return false;
  } finally {
    view.manualQueueBusy = false;
    syncEditorQueueControls(node);
    view.autoQueue?.resume();
  }
}


function handlePresetJobsSubmissionState(event) {
  presetJobsSubmissionBusy = event?.detail?.busy === true;
  const view = editorView;
  if (!view) return;
  syncEditorQueueControls(view.node);
  if (!presetJobsSubmissionBusy) view.autoQueue?.resume();
}


function withCanvasChange(callback) {
  const canvas = app.canvas;
  const transactional = typeof canvas?.emitBeforeChange === "function"
    && typeof canvas?.emitAfterChange === "function";
  if (transactional) canvas.emitBeforeChange();
  try {
    return callback();
  } finally {
    if (transactional) canvas.emitAfterChange();
  }
}


function commit(
  node,
  {
    presetDirty = false,
    fullPresetDirty = false,
    render = true,
    folderSyncDirty = false,
    clearFolderSyncErrors = false,
  } = {},
) {
  withCanvasChange(() => {
    if (folderSyncDirty) invalidateSectionSync(node, clearFolderSyncErrors);
    const selectedPreset = node.__apexPresets?.find(
      (preset) => preset.id === node.__apexState.active_preset_id,
    );
    if (presetDirty || (fullPresetDirty && presetType(selectedPreset) === "full")) {
      node.__apexState.active_preset_id = null;
    }
    const widget = dataWidget(node);
    if (widget) widget.value = serializeState(node.__apexState);
    node.graph?.change?.();
    node.setDirtyCanvas?.(true, true);
    if (render) renderNode(node);
  });
}


function svgIcon(name) {
  const definition = ICONS[name];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("apex-svg", "lucide", definition.className);
  for (const [tag, attributes] of definition.nodes) {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, value);
    svg.appendChild(child);
  }
  return svg;
}


function iconButton(icon, title, className = "", label = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.className = `apex-icon ${className}`.trim();
  button.appendChild(svgIcon(icon));
  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);
  }
  return button;
}


function textIconButton(text, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.className = "apex-icon";
  return button;
}


function closeTriggerPreview() {
  if (!openTriggerPreview) return;
  openTriggerPreview.anchor?.removeAttribute("aria-describedby");
  openTriggerPreview.element.remove();
  openTriggerPreview = null;
}


function showTriggerPreview(anchor, node, row) {
  closeTriggerPreview();
  if (!anchor?.isConnected || !row) return;
  const metadata = normalizeTriggerMetadata(row);
  if (!metadata.trigger_words.length) return;
  const activeWords = new Set(metadata.active_trigger_words);
  const placement = normalizeTriggerPosition(row.trigger_position);

  const tooltip = document.createElement("div");
  tooltip.className = "apex-preview-trigger-tooltip";
  tooltip.id = `apex-trigger-preview-${++triggerPreviewSequence}`;
  tooltip.setAttribute("role", "tooltip");

  const header = document.createElement("div");
  header.className = "apex-trigger-tooltip-header";
  const heading = document.createElement("div");
  heading.className = "apex-trigger-tooltip-heading";
  const title = document.createElement("strong");
  title.textContent = "Trigger words";
  const identity = document.createElement("span");
  identity.textContent = previewDisplayName(row.name, node.__apexState.settings) || row.name;
  heading.append(title, identity);
  const placementBadge = document.createElement("span");
  placementBadge.className = `apex-trigger-tooltip-placement ${placement}`;
  placementBadge.textContent = placement === "prepend" ? "Before prompt" : "After prompt";
  header.append(heading, placementBadge);
  tooltip.appendChild(header);

  const appendGroup = (label, words, emptyText, highlightActive = false) => {
    const group = document.createElement("div");
    group.className = "apex-trigger-tooltip-group";
    const groupLabel = document.createElement("span");
    groupLabel.className = "apex-trigger-tooltip-label";
    groupLabel.textContent = label;
    const values = document.createElement("div");
    values.className = "apex-trigger-tooltip-values";
    if (!words.length) {
      const empty = document.createElement("span");
      empty.className = "apex-trigger-tooltip-empty";
      empty.textContent = emptyText;
      values.appendChild(empty);
    } else {
      for (const word of words) {
        const chip = document.createElement("span");
        chip.className = `apex-trigger-tooltip-chip${
          highlightActive && activeWords.has(word) ? " active" : ""
        }`;
        chip.textContent = word;
        values.appendChild(chip);
      }
    }
    group.append(groupLabel, values);
    tooltip.appendChild(group);
  };

  appendGroup(
    `Active (${metadata.active_trigger_words.length})`,
    metadata.active_trigger_words,
    "No trigger words selected",
    true,
  );
  appendGroup(
    `All saved (${metadata.trigger_words.length})`,
    metadata.trigger_words,
    "No saved trigger words",
    true,
  );

  document.body.appendChild(tooltip);
  anchor.setAttribute("aria-describedby", tooltip.id);
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const rightSpace = window.innerWidth - anchorRect.right;
  const left = rightSpace >= tooltipRect.width + 8
    ? anchorRect.right + 8
    : Math.max(8, anchorRect.left - tooltipRect.width - 8);
  const top = Math.max(
    8,
    Math.min(anchorRect.top - 4, window.innerHeight - tooltipRect.height - 8),
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  openTriggerPreview = { element: tooltip, anchor };
}


function attachTriggerPreview(anchor, node, row) {
  anchor.addEventListener("pointerenter", () => showTriggerPreview(anchor, node, row));
  anchor.addEventListener("pointerleave", closeTriggerPreview);
  anchor.addEventListener("focus", () => showTriggerPreview(anchor, node, row));
  anchor.addEventListener("blur", closeTriggerPreview);
}


function closeOpenPopover() {
  openPopover?.close();
  openPopover = null;
}


function createPopover(anchor, title, className = "") {
  closeOpenPopover();
  const panel = document.createElement("div");
  panel.className = `apex-popover ${className}`.trim();
  const header = document.createElement("div");
  header.className = "apex-popover-header";
  const heading = document.createElement("span");
  heading.className = "apex-popover-title";
  heading.textContent = title;
  const close = textIconButton("×", "Close");
  close.classList.add("apex-popover-close");
  header.append(heading, close);
  panel.appendChild(header);
  const host = editorView?.overlay?.isConnected ? editorView.overlay : document.body;
  host.appendChild(panel);

  const rect = anchor?.getBoundingClientRect?.() || {
    left: window.innerWidth / 2,
    right: window.innerWidth / 2,
    top: window.innerHeight / 3,
    bottom: window.innerHeight / 3,
  };
  const position = () => {
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelRect.width - 8));
    let top = rect.bottom + 5;
    if (top + panelRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelRect.height - 5);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  position();
  requestAnimationFrame(position);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keydown, true);
    panel.remove();
    if (openPopover?.panel === panel) openPopover = null;
  };
  const outside = (event) => {
    if (!panel.contains(event.target)) dispose();
  };
  const keydown = (event) => {
    if (event.key === "Escape") dispose();
  };
  close.addEventListener("click", dispose);
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
  }, 0);
  openPopover = { panel, close: dispose };
  return { panel, close: dispose };
}


function splitName(name) {
  const index = name.lastIndexOf("/");
  return index === -1
    ? { path: "", file: name }
    : { path: name.slice(0, index + 1), file: name.slice(index + 1) };
}


function loraNameContent(name, settings) {
  const { path, file } = splitName(name);
  const fragment = document.createDocumentFragment();
  if (path && settings.show_folder_paths) {
    const pathElement = document.createElement("span");
    pathElement.className = "path";
    pathElement.textContent = path;
    fragment.appendChild(pathElement);
  }
  const fileElement = document.createElement("span");
  fileElement.className = "file";
  fileElement.textContent = settings.show_safetensors
    ? file
    : file.replace(/\.safetensors$/i, "");
  fragment.appendChild(fileElement);
  return fragment;
}


function sectionById(node, sectionId) {
  return node.__apexState.sections.find((section) => section.id === sectionId);
}


function rowById(node, rowId) {
  return allRows(node.__apexState).find((row) => row.id === rowId);
}


function rowIdentity(row) {
  return {
    name: row?.name || "",
    sha256: row?.sha256 || "",
    size: Number.isInteger(row?.size) ? row.size : 0,
  };
}


function recordSectionSyncRemoval(section, row) {
  const config = normalizeSectionSync(section?.folder_sync);
  const configured = (
    config.enabled
    || config.include_folders.length > 0
    || config.exclude_folders.length > 0
    || config.seen_names.length > 0
    || config.ignored.length > 0
  );
  if (!section || !configured) return false;
  section.folder_sync = addIgnoredIdentity(config, rowIdentity(row));
  return true;
}


function recordSectionSyncAddition(section, row) {
  const config = normalizeSectionSync(section?.folder_sync);
  if (!section) return false;
  section.folder_sync = recordSectionSyncExplicitAdditions(
    config,
    [rowIdentity(row)],
    catalogCache?.loras,
  );
  return true;
}


function allowSectionSyncIdentity(section, identity) {
  const config = normalizeSectionSync(section?.folder_sync);
  let next = removeIgnoredIdentity(config, identity);
  const names = new Set(next.seen_names);
  names.delete(identity?.name);
  next.seen_names = [...names];
  section.folder_sync = normalizeSectionSync(next);
}


function migrateSectionSyncIdentity(section, oldIdentity, nextIdentity) {
  const config = normalizeSectionSync(section?.folder_sync);
  let changed = false;
  const seen = config.seen_names.map((name) => {
    if (name !== oldIdentity?.name) return name;
    changed = true;
    return nextIdentity.name;
  });
  const ignoredMatch = config.ignored.some(
    (entry) => entry.name === oldIdentity?.name,
  );
  let next = { ...config, seen_names: seen };
  if (ignoredMatch) {
    next = removeIgnoredIdentity(next, oldIdentity);
    next = addIgnoredIdentity(next, nextIdentity);
    changed = true;
  }
  if (changed) section.folder_sync = normalizeSectionSync(next);
  return changed;
}


function moveRowWithSectionSync(node, rowId, targetSectionId, targetIndex) {
  const source = node.__apexState.sections.find(
    (section) => section.loras.some((row) => row.id === rowId),
  );
  const target = sectionById(node, targetSectionId);
  const row = source?.loras.find((item) => item.id === rowId);
  if (!source || !target || !row) return false;
  const moved = moveRow(node.__apexState, rowId, targetSectionId, targetIndex);
  if (!moved) return false;
  if (source !== target) {
    recordSectionSyncRemoval(source, row);
    recordSectionSyncAddition(target, row);
  }
  return true;
}


function sameTriggerMetadata(left, right) {
  const a = normalizeTriggerMetadata(left);
  const b = normalizeTriggerMetadata(right);
  return a.trigger_words.length === b.trigger_words.length
    && a.trigger_words.every((word, index) => word === b.trigger_words[index])
    && a.active_trigger_words.length === b.active_trigger_words.length
    && a.active_trigger_words.every((word, index) => word === b.active_trigger_words[index]);
}


function applyTriggerMetadata(row, value) {
  const changed = !sameTriggerMetadata(row, value) || "trigger_word" in row;
  const metadata = normalizeTriggerMetadata(value);
  row.trigger_words = metadata.trigger_words;
  row.active_trigger_words = metadata.active_trigger_words;
  delete row.active_trigger_word;
  delete row.trigger_word;
  return changed;
}


async function identifyNames(names, force = false) {
  const data = await fetchJson("/apex_lora_loader/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, force }),
  });
  metadataCache = null;
  return data.entries || [];
}


async function showLoraChooser(node, anchor, sectionId, rowId = null) {
  try {
    setStatus(node, "Loading LoRA list…");
    const loadingStatus = node.__apexStatus;
    const catalog = await loadCatalog();
    const targetExists = rowId ? rowById(node, rowId) : sectionById(node, sectionId);
    if (!editorAnchorIsActive(node, anchor) || !targetExists) {
      if (node.__apexStatus === loadingStatus) setStatus(node, "");
      return;
    }
    const choices = catalog.loras.filter((name) =>
      matchesFolderFilters(name, node.__apexState.folder_filters),
    );
    const { panel, close } = createPopover(anchor, rowId ? "Change LoRA" : "Add LoRA");
    const search = document.createElement("input");
    search.className = "apex-search";
    search.type = "search";
    search.placeholder = "Search LoRAs…";
    const controls = document.createElement("div");
    controls.className = "apex-chooser-tools";
    const chooserActions = document.createElement("div");
    chooserActions.className = "apex-chooser-actions";
    controls.append(search, chooserActions);
    const list = document.createElement("div");
    list.className = "apex-list";
    panel.append(controls, list);

    if (!rowId) {
      const section = sectionById(node, sectionId);
      const existingNames = new Set(section?.loras.map((row) => row.name) || []);
      const namesToAdd = choices.filter((name) => !existingNames.has(name));
      const addAll = document.createElement("button");
      addAll.type = "button";
      addAll.className = "apex-add-all apex-primary-action";
      addAll.textContent = "Add all LoRAs";
      addAll.disabled = namesToAdd.length === 0;
      addAll.title = namesToAdd.length
        ? "Add every LoRA offered by the current folder filters"
        : "This section already contains every offered LoRA";
      addAll.addEventListener("click", async () => {
        const target = sectionById(node, sectionId);
        if (!target) {
          setStatus(node, "The target section no longer exists.", true);
          return;
        }
        const noun = namesToAdd.length === 1 ? "LoRA" : "LoRAs";
        if (!window.confirm(`Are you sure you want to add ${namesToAdd.length} ${noun} to section "${target.name}"?`)) return;
        try {
          addAll.disabled = true;
          search.disabled = true;
          addAll.textContent = "Adding…";
          setStatus(node, `Identifying LoRAs 0/${namesToAdd.length}…`);
          const identities = [];
          for (let index = 0; index < namesToAdd.length; index += 512) {
            const batch = await identifyNames(namesToAdd.slice(index, index + 512));
            identities.push(...batch);
            setStatus(node, `Identifying LoRAs ${identities.length}/${namesToAdd.length}…`);
          }
          const currentTarget = sectionById(node, sectionId);
          if (!currentTarget) throw new Error("The target section no longer exists.");
          const currentNames = new Set(currentTarget.loras.map((row) => row.name));
          const addedRows = [];
          let added = 0;
          for (const identity of identities) {
            if (currentNames.has(identity.name)) continue;
            const newRow = createRow(identity);
            currentTarget.loras.push(newRow);
            addedRows.push(newRow);
            currentNames.add(identity.name);
            added += 1;
          }
          currentTarget.folder_sync = recordSectionSyncExplicitAdditions(
            currentTarget.folder_sync,
            addedRows,
            catalogCache?.loras,
          );
          currentTarget.collapsed = false;
          commit(node, { presetDirty: true, folderSyncDirty: true });
          close();
          setStatus(node, `Added ${added} LoRA${added === 1 ? "" : "s"} to "${currentTarget.name}".`);
        } catch (error) {
          addAll.disabled = false;
          search.disabled = false;
          addAll.textContent = "Add all LoRAs";
          setStatus(node, error.message, true);
        }
      });
      chooserActions.appendChild(addAll);

      const syncStatus = sectionSyncStatus(node, sectionId);
      const folderSync = iconButton(
        "folderSync",
        syncStatus.config.enabled
          ? `Manage folder sync (${syncStatus.actionable.length} pending)`
          : "Configure folder sync for this section",
        "apex-folder-sync-open",
      );
      folderSync.classList.toggle("active", syncStatus.config.enabled);
      if (syncStatus.actionable.length) {
        const badge = document.createElement("span");
        badge.className = "apex-folder-sync-tool-badge";
        badge.textContent = syncStatus.actionable.length > 99
          ? "99+"
          : String(syncStatus.actionable.length);
        folderSync.appendChild(badge);
      }
      folderSync.addEventListener("click", () => {
        close();
        showSectionFolderSync(node, anchor, sectionId);
      });
      chooserActions.appendChild(folderSync);
    }

    const renderChoices = () => {
      list.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const visible = query
        ? choices.filter((name) => name.toLocaleLowerCase().includes(query))
        : choices;
      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "apex-empty";
        empty.textContent = choices.length
          ? "No matching LoRAs."
          : "No LoRAs are available under the selected folder filters.";
        list.appendChild(empty);
        return;
      }
      for (const name of visible.slice(0, 500)) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "apex-list-item";
        item.title = name;
        item.appendChild(loraNameContent(name, node.__apexState.settings));
        item.addEventListener("click", async () => {
          try {
            item.disabled = true;
            setStatus(node, `Identifying ${splitName(name).file}…`);
            const [identity] = await identifyNames([name]);
            if (!identity) throw new Error("The selected LoRA could not be identified.");
            let successMessage = "";
            if (rowId) {
              const row = rowById(node, rowId);
              if (!row) return;
              const section = sectionById(node, sectionId);
              if (section) recordSectionSyncRemoval(section, row);
              Object.assign(row, identity);
              applyTriggerMetadata(row, identity);
              delete row.error;
              if (section) recordSectionSyncAddition(section, row);
              successMessage = `Changed LoRA to "${splitName(identity.name).file}".`;
            } else {
              const section = sectionById(node, sectionId);
              if (!section) return;
              const newRow = createRow(identity);
              section.loras.push(newRow);
              recordSectionSyncAddition(section, newRow);
              section.collapsed = false;
              successMessage = `Added "${splitName(identity.name).file}" to "${section.name}".`;
            }
            commit(node, { presetDirty: true, folderSyncDirty: true });
            close();
            setStatus(node, successMessage);
          } catch (error) {
            item.disabled = false;
            setStatus(node, error.message, true);
          }
        });
        list.appendChild(item);
      }
      if (visible.length > 500) {
        const more = document.createElement("div");
        more.className = "apex-empty";
        more.textContent = `Showing 500 of ${visible.length}; search to narrow the list.`;
        list.appendChild(more);
      }
    };
    search.addEventListener("input", renderChoices);
    renderChoices();
    setTimeout(() => search.focus(), 20);
    setStatus(node, "");
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


async function showFolderChooser(node, anchor) {
  try {
    const catalog = await loadCatalog();
    if (!editorAnchorIsActive(node, anchor)) return;
    let draft = node.__apexState.folder_filters === null
      ? null
      : [...node.__apexState.folder_filters];
    const { panel, close } = createPopover(anchor, "LoRA folders");
    const actions = document.createElement("div");
    actions.className = "apex-popover-actions";
    const all = document.createElement("button");
    all.textContent = "All";
    const none = document.createElement("button");
    none.textContent = "None";
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.className = "apex-primary-action";
    actions.append(all, none, apply);
    const list = document.createElement("div");
    list.className = "apex-list";
    panel.append(actions, list);

    const renderFolders = () => {
      list.replaceChildren();
      for (const folder of catalog.folders) {
        const label = document.createElement("label");
        label.className = "apex-folder-row";
        label.style.paddingLeft = `${7 + (folder ? folder.split("/").length - 1 : 0) * 14}px`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const inherited = draft !== null && folder !== "" && draft.some(
          (selected) => selected !== "" && selected !== folder && folder.startsWith(`${selected}/`),
        );
        checkbox.checked = draft === null || draft.includes(folder) || inherited;
        checkbox.disabled = inherited;
        if (inherited) checkbox.title = "Included by a selected parent folder";
        checkbox.indeterminate = draft !== null && folder !== "" &&
          draft.some((selected) => selected.startsWith(`${folder}/`));
        const name = document.createElement("span");
        name.textContent = folder || "(root)";
        name.title = folder || "LoRAs directly in the root LoRA folder";
        checkbox.addEventListener("change", () => {
          if (draft === null) draft = [folder];
          else if (checkbox.checked) draft.push(folder);
          else draft = draft.filter((item) => item !== folder);
          draft = [...new Set(draft)];
          renderFolders();
        });
        label.append(checkbox, name);
        list.appendChild(label);
      }
    };
    all.addEventListener("click", () => { draft = null; renderFolders(); });
    none.addEventListener("click", () => { draft = []; renderFolders(); });
    apply.addEventListener("click", () => {
      if (draft !== null) {
        draft.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
        draft = draft.filter((folder, index) => !draft.some(
          (parent, parentIndex) => parentIndex < index && parent !== "" && folder.startsWith(`${parent}/`),
        ));
      }
      node.__apexState.folder_filters = draft === null
        ? null
        : [...new Set(draft)].sort((a, b) => a.localeCompare(b));
      commit(node, { fullPresetDirty: true, folderSyncDirty: true });
      close();
    });
    renderFolders();
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


function sameSectionSyncConfig(left, right) {
  return JSON.stringify(normalizeSectionSync(left)) === JSON.stringify(normalizeSectionSync(right));
}


function folderIsWithin(folder, parent) {
  return parent === "" || folder === parent || folder.startsWith(`${parent}/`);
}


function folderAllowedByNodeFilters(folder, filters) {
  if (filters === null) return true;
  if (!Array.isArray(filters) || !filters.length) return false;
  return filters.some((filter) => {
    if (filter === "") return folder === "";
    return folder === filter || folder.startsWith(`${filter}/`);
  });
}


function folderVisibleUnderNodeFilters(folder, filters) {
  if (folderAllowedByNodeFilters(folder, filters)) return true;
  if (filters === null || !Array.isArray(filters)) return filters === null;
  return filters.some((filter) => (
    filter !== ""
    && (folder === "" || filter.startsWith(`${folder}/`))
  ));
}


function setFolderSyncSubtree(config, folder, selected) {
  const next = normalizeSectionSync(config);
  next.include_folders = next.include_folders.filter(
    (value) => !folderIsWithin(value, folder),
  );
  next.exclude_folders = next.exclude_folders.filter(
    (value) => !folderIsWithin(value, folder),
  );
  (selected ? next.include_folders : next.exclude_folders).push(folder);
  return normalizeSectionSync(next);
}


async function resolveSectionSyncNames(names, onProgress = null) {
  const entries = [];
  const errors = [];
  for (let index = 0; index < names.length; index += 512) {
    const batch = names.slice(index, index + 512);
    try {
      const data = await fetchJson("/apex_lora_loader/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: batch.map((name, batchIndex) => ({
            id: `folder-sync-${index + batchIndex}`,
            name,
            sha256: "",
            size: 0,
          })),
          force: false,
        }),
      });
      entries.push(...(data.entries || []));
      errors.push(...(data.errors || []));
    } catch (error) {
      errors.push(...batch.map((name) => ({ name, error: error.message })));
    }
    if (
      onProgress?.(Math.min(index + batch.length, names.length), names.length)
      === false
    ) {
      break;
    }
  }
  if (entries.length) metadataCache = null;
  return { entries, errors };
}


function applySectionSyncResolution(
  node,
  sectionId,
  names,
  resolved,
  catalogNames,
  automatic = false,
) {
  const section = sectionById(node, sectionId);
  if (!section) return { aborted: true, added: 0, renamed: 0, failed: 0 };
  const plan = planVerifiedSyncCandidates(
    names,
    resolved.entries,
    section.loras,
    section.folder_sync,
    catalogNames,
  );
  const fullIdentities = new Map(
    resolved.entries.map((identity) => [identity.name, identity]),
  );
  const acknowledged = [];
  let renamed = 0;
  for (const rename of plan.renames) {
    const row = section.loras.find((item) => item.id === rename.row_id);
    const identity = fullIdentities.get(rename.identity.name) || rename.identity;
    const normalizedIdentity = normalizeSectionSyncIdentity(identity);
    if (!row || !normalizedIdentity) continue;
    const previous = rowIdentity(row);
    row.name = normalizedIdentity.name;
    row.sha256 = normalizedIdentity.sha256;
    row.size = normalizedIdentity.size;
    applyTriggerMetadata(row, identity);
    delete row.error;
    migrateSectionSyncIdentity(section, previous, rowIdentity(row));
    acknowledged.push(normalizedIdentity.name);
    renamed += 1;
  }
  let added = 0;
  for (const addition of plan.additions) {
    const identity = fullIdentities.get(addition.name) || addition;
    const row = createRow(identity);
    row.enabled = false;
    section.loras.push(row);
    acknowledged.push(identity.name);
    added += 1;
  }
  const ignoredIdentities = [];
  for (const skipped of plan.skipped) {
    const identity = fullIdentities.get(skipped.name);
    if (skipped.reason === "ignored" && identity) {
      ignoredIdentities.push(identity);
      acknowledged.push(identity.name);
    } else if (skipped.reason === "existing") {
      acknowledged.push(skipped.name);
    }
  }
  if (ignoredIdentities.length) {
    section.folder_sync = reconcileIgnoredIdentities(
      section.folder_sync,
      ignoredIdentities,
      catalogNames,
    );
  }
  let config = normalizeSectionSync(section.folder_sync);
  if (config.mode === "new") config = markSectionSyncSeen(config, acknowledged);
  section.folder_sync = config;

  const errors = new Map();
  for (const error of resolved.errors) {
    if (typeof error?.name === "string") {
      errors.set(error.name, error.error || "Unable to identify this LoRA.");
    }
  }
  for (const skipped of plan.skipped) {
    if (skipped.reason === "unverified" && !errors.has(skipped.name)) {
      errors.set(skipped.name, "Unable to verify this LoRA.");
    }
  }
  if (!node.__apexFolderSyncErrors) node.__apexFolderSyncErrors = new Map();
  node.__apexFolderSyncErrors.set(sectionId, errors);
  if (automatic && added) {
    if (!node.__apexFolderAutoSyncAdded) node.__apexFolderAutoSyncAdded = new Map();
    node.__apexFolderAutoSyncAdded.set(
      sectionId,
      (node.__apexFolderAutoSyncAdded.get(sectionId) || 0) + added,
    );
  }
  commit(node, { fullPresetDirty: true, folderSyncDirty: true });
  return {
    aborted: false,
    sectionId,
    sectionName: section.name,
    added,
    renamed,
    failed: errors.size,
  };
}


function showNativeToast(options) {
  try {
    const toast = app.extensionManager?.toast;
    if (!toast?.add) return false;
    toast.add(options);
    return true;
  } catch (error) {
    console.warn("[Apex LoRA Loader] Could not show a ComfyUI toast.", error);
    return false;
  }
}


async function autoSyncNodeSections(node) {
  const results = [];
  if (!node?.__apexBuilt || !node.__apexState || !catalogCache) return results;
  const sectionIds = node.__apexState.sections.map((section) => section.id);
  for (const sectionId of sectionIds) {
    const section = sectionById(node, sectionId);
    if (!section) continue;
    const status = sectionSyncStatus(node, sectionId);
    if (
      !status.config.enabled
      || !status.config.auto_sync
      || !status.actionable.length
    ) continue;

    const names = [...status.actionable];
    const stateRevision = node.__apexFolderSyncRevision || 0;
    const activeCatalogRevision = catalogRevision;
    setStatus(
      node,
      `Auto-sync verifying ${names.length} LoRA${names.length === 1 ? "" : "s"} for “${section.name}”…`,
    );
    const resolved = await resolveSectionSyncNames(
      names,
      (completed, total) => {
        if (
          !node.__apexBuilt
          || sectionById(node, sectionId) !== section
          || (node.__apexFolderSyncRevision || 0) !== stateRevision
          || catalogRevision !== activeCatalogRevision
        ) return false;
        setStatus(node, `Auto-sync verifying LoRAs ${completed}/${total}…`);
        return true;
      },
    );
    if (
      !node.__apexBuilt
      || sectionById(node, sectionId) !== section
      || (node.__apexFolderSyncRevision || 0) !== stateRevision
      || catalogRevision !== activeCatalogRevision
    ) {
      continue;
    }
    const result = applySectionSyncResolution(
      node,
      sectionId,
      names,
      resolved,
      catalogCache.loras,
      true,
    );
    if (!result.aborted) results.push({ ...result, node });
  }
  return results;
}


async function performAutoSyncPass(nodes) {
  const results = [];
  for (const node of [...new Set(nodes)]) {
    if (!node?.__apexBuilt || !node.__apexState) continue;
    try {
      results.push(...await autoSyncNodeSections(node));
    } catch (error) {
      setStatus(node, error?.message || "Automatic folder sync failed.", true);
      results.push({
        node,
        sectionId: null,
        sectionName: "",
        added: 0,
        renamed: 0,
        failed: 1,
      });
    }
  }

  const added = results.reduce((total, result) => total + result.added, 0);
  const renamed = results.reduce((total, result) => total + result.renamed, 0);
  const failed = results.reduce((total, result) => total + result.failed, 0);
  const sectionResults = results.filter((result) => result.sectionId);
  const affectedSectionKeys = new Set(
    sectionResults.map((result) => `${result.node?.id}:${result.sectionId}`),
  );
  const affectedSections = affectedSectionKeys.size;
  if (!added && !renamed && !failed) return results;

  const parts = [];
  if (added) parts.push(
    `Added ${added} LoRA${added === 1 ? "" : "s"} as disabled row${added === 1 ? "" : "s"}`,
  );
  if (renamed) parts.push(`recovered ${renamed} renamed file${renamed === 1 ? "" : "s"}`);
  let detail = parts.join(" and ");
  if (failed) {
    detail += `${detail ? "; " : ""}${failed} could not be verified`;
  }
  if (affectedSections === 1) {
    detail += ` in “${sectionResults[0].sectionName}”`;
  } else if (affectedSections > 1) {
    detail += ` across ${affectedSections} sections`;
  }
  detail += ".";

  const severity = failed
    ? added || renamed ? "warn" : "error"
    : "success";
  showNativeToast({
    severity,
    summary: failed ? "Apex Auto Sync completed with issues" : "Apex Auto Sync",
    detail,
    life: failed ? 10000 : 8000,
  });

  const resultsByNode = new Map();
  for (const result of results) {
    if (!resultsByNode.has(result.node)) resultsByNode.set(result.node, []);
    resultsByNode.get(result.node).push(result);
  }
  for (const [node, nodeResults] of resultsByNode) {
    const nodeAdded = nodeResults.reduce((total, result) => total + result.added, 0);
    const nodeRenamed = nodeResults.reduce((total, result) => total + result.renamed, 0);
    const nodeFailed = nodeResults.reduce((total, result) => total + result.failed, 0);
    const summary = [
      nodeAdded ? `${nodeAdded} added` : "",
      nodeRenamed ? `${nodeRenamed} renamed` : "",
      nodeFailed ? `${nodeFailed} failed` : "",
    ].filter(Boolean).join(", ");
    setStatus(node, `Auto-sync: ${summary}.`, nodeFailed > 0);
  }
  openPopover?.refresh?.();
  return results;
}


function queueAutoSyncPass(nodes) {
  const requestedNodes = [...new Set(Array.isArray(nodes) ? nodes : [])];
  const run = autoSyncPassQueue
    .catch(() => {})
    .then(() => performAutoSyncPass(requestedNodes));
  autoSyncPassQueue = run.catch((error) => {
    console.error("[Apex LoRA Loader] Automatic folder sync failed.", error);
  });
  return run;
}


async function showSectionFolderSync(node, anchor, sectionId) {
  try {
    setStatus(node, "Loading folder sync…");
    const loadingStatus = node.__apexStatus;
    const catalog = await loadCatalog();
    if (!editorAnchorIsActive(node, anchor) || !sectionById(node, sectionId)) {
      if (node.__apexStatus === loadingStatus) setStatus(node, "");
      return;
    }
    refreshNodeSectionSyncStatus(node, false);
    const { panel } = createPopover(
      anchor,
      "Section folder sync",
      "apex-folder-sync-popover",
    );
    const body = document.createElement("div");
    body.className = "apex-folder-sync-body";
    panel.appendChild(body);
    let draft = normalizeSectionSync(sectionById(node, sectionId).folder_sync);
    let busy = false;
    node.__apexFolderSyncOperationToken =
      (node.__apexFolderSyncOperationToken || 0) + 1;

    const beginOperation = () => {
      const section = sectionById(node, sectionId);
      const token = (node.__apexFolderSyncOperationToken || 0) + 1;
      node.__apexFolderSyncOperationToken = token;
      return {
        token,
        section,
        stateRevision: node.__apexFolderSyncRevision || 0,
        catalogRevision,
      };
    };

    const operationIsCurrent = (operation) => (
      Boolean(operation?.section)
      && panel.isConnected
      && node.__apexFolderSyncOperationToken === operation.token
      && sectionById(node, sectionId) === operation.section
      && (node.__apexFolderSyncRevision || 0) === operation.stateRevision
      && catalogRevision === operation.catalogRevision
    );

    const abandonOperation = (operation, status = null) => {
      if (node.__apexFolderSyncOperationToken === operation?.token) busy = false;
      if (status && node.__apexStatus === status) setStatus(node, "");
      if (panel.isConnected) renderPanel();
    };

    const renderPanel = () => {
      if (!panel.isConnected) return;
      const section = sectionById(node, sectionId);
      if (!section) {
        closeOpenPopover();
        return;
      }
      const live = normalizeSectionSync(section.folder_sync);
      const status = sectionSyncStatus(node, sectionId);
      const activeCatalog = catalogCache || catalog;
      const dirty = !sameSectionSyncConfig(draft, live);
      body.replaceChildren();

      const summary = document.createElement("div");
      summary.className = "apex-folder-sync-summary";
      const summaryText = document.createElement("div");
      summaryText.className = "apex-folder-sync-summary-copy";
      const summaryTitle = document.createElement("strong");
      summaryTitle.textContent = live.enabled
        ? live.mode === "new"
          ? "New LoRAs only"
          : "Folder mirror"
        : "Folder sync off";
      const summaryDetail = document.createElement("span");
      summaryDetail.textContent = live.enabled
        ? `${live.include_folders.length} linked · ${live.exclude_folders.length} excluded · ${status.actionable.length} pending${live.auto_sync ? " · auto" : ""}`
        : `${live.include_folders.length} linked folder${live.include_folders.length === 1 ? "" : "s"} retained while paused`;
      summaryDetail.title = [
        live.include_folders.length
          ? `Linked: ${live.include_folders.map((folder) => folder || "(LoRA root)").join(", ")}`
          : "No linked folders",
        live.exclude_folders.length
          ? `Excluded: ${live.exclude_folders.map((folder) => folder || "(LoRA root)").join(", ")}`
          : "",
      ].filter(Boolean).join("\n");
      summaryText.append(summaryTitle, summaryDetail);
      const summaryCount = document.createElement("span");
      summaryCount.className = `apex-folder-sync-count${status.actionable.length ? " active" : ""}`;
      summaryCount.textContent = String(status.actionable.length);
      summaryCount.title = "LoRAs ready to synchronize";
      summary.append(summaryText, summaryCount);
      body.appendChild(summary);

      const modeLabel = document.createElement("span");
      modeLabel.className = "apex-folder-sync-label";
      modeLabel.textContent = "Behavior";
      const modes = document.createElement("div");
      modes.className = "apex-folder-sync-modes";
      const activeMode = draft.enabled ? draft.mode : "off";
      for (const [value, label, title] of [
        ["off", "Off", "Pause detection while retaining this setup"],
        ["mirror", "Folder mirror", "Offer every linked-folder LoRA missing from this section"],
        ["new", "New LoRAs only", "Offer only LoRAs discovered after the baseline"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.className = activeMode === value ? "active" : "";
        button.disabled = busy;
        button.addEventListener("click", () => {
          if (value === "off") draft.enabled = false;
          else {
            draft.enabled = true;
            draft.mode = value;
          }
          draft = normalizeSectionSync(draft);
          renderPanel();
        });
        modes.appendChild(button);
      }
      body.append(modeLabel, modes);

      const folderHeading = document.createElement("div");
      folderHeading.className = "apex-folder-sync-heading";
      const folderLabel = document.createElement("span");
      folderLabel.className = "apex-folder-sync-label";
      folderLabel.textContent = "Linked folders";
      const folderHint = document.createElement("small");
      folderHint.textContent = "Parents include future subfolders; child choices override them";
      folderHeading.append(folderLabel, folderHint);
      const folderList = document.createElement("div");
      folderList.className = "apex-folder-sync-folders";
      const configuredFolders = new Set([
        ...draft.include_folders,
        ...draft.exclude_folders,
      ]);
      const folderTree = sectionSyncFolderTree([...new Set([
        ...(activeCatalog.folders || []).filter((folder) => (
          folderVisibleUnderNodeFilters(folder, node.__apexState.folder_filters)
        )),
        ...configuredFolders,
      ])]);
      const visibleFolders = folderTree.map(({ folder }) => folder);
      const folderDepths = new Map(
        folderTree.map(({ folder, depth }) => [folder, depth]),
      );
      const selectionStates = sectionSyncFolderSelectionStates(visibleFolders, draft);
      const visibleFolderSet = new Set(visibleFolders);
      const mixedFolders = new Set();
      for (const folder of visibleFolders) {
        const selected = selectionStates.get(folder) === true;
        let ancestor = folder;
        while (ancestor) {
          const separator = ancestor.lastIndexOf("/");
          ancestor = separator === -1 ? "" : ancestor.slice(0, separator);
          if (
            visibleFolderSet.has(ancestor)
            && (selectionStates.get(ancestor) === true) !== selected
          ) {
            mixedFolders.add(ancestor);
          }
        }
      }
      for (const folder of visibleFolders) {
        const allowed = folderAllowedByNodeFilters(
          folder,
          node.__apexState.folder_filters,
        );
        const selected = selectionStates.get(folder) === true;
        const mixed = mixedFolders.has(folder);
        const row = document.createElement("label");
        row.className = `apex-folder-sync-folder${allowed ? "" : " filtered"}`;
        row.style.paddingLeft = `${7 + (folderDepths.get(folder) || 0) * 15}px`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected;
        checkbox.indeterminate = mixed;
        checkbox.disabled = busy || (!allowed && !configuredFolders.has(folder));
        const name = document.createElement("span");
        name.textContent = folder || "(LoRA root)";
        name.title = allowed
          ? folder || "The complete LoRA folder"
          : configuredFolders.has(folder)
            ? "Stored rule; currently outside the node-wide folder filters"
            : "Unavailable under the node-wide folder filters";
        checkbox.addEventListener("change", () => {
          draft = setFolderSyncSubtree(draft, folder, checkbox.checked);
          renderPanel();
        });
        row.append(checkbox, name);
        folderList.appendChild(row);
      }
      if (!visibleFolders.length) {
        const empty = document.createElement("div");
        empty.className = "apex-empty";
        empty.textContent = "No folders are available under the node-wide folder filters.";
        folderList.appendChild(empty);
      }
      body.append(folderHeading, folderList);

      const unavailable = [...new Set([
        ...draft.include_folders,
        ...draft.exclude_folders,
      ])].filter((folder) => (
        !(activeCatalog.folders || []).includes(folder)
        || !folderVisibleUnderNodeFilters(folder, node.__apexState.folder_filters)
      ));
      if (unavailable.length) {
        const warning = document.createElement("div");
        warning.className = "apex-folder-sync-warning";
        warning.textContent = `${unavailable.length} stored folder rule${unavailable.length === 1 ? " is" : "s are"} currently missing or outside the node-wide filters.`;
        body.appendChild(warning);
      }

      const configActions = document.createElement("div");
      configActions.className = "apex-folder-sync-config-actions";
      const configState = document.createElement("div");
      configState.className = `apex-folder-sync-config-state${dirty ? " dirty" : ""}`;
      const configStateLabel = document.createElement("strong");
      configStateLabel.textContent = "Configuration";
      const configStateValue = document.createElement("span");
      configStateValue.textContent = dirty ? "Unsaved changes" : "Saved";
      configState.append(configStateLabel, configStateValue);
      const configButtons = document.createElement("div");
      configButtons.className = "apex-folder-sync-config-buttons";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "apex-danger-action";
      reset.textContent = "Clear setup";
      reset.disabled = busy || !(
        live.enabled
        || live.auto_sync
        || live.include_folders.length
        || live.exclude_folders.length
        || live.seen_names.length
        || live.ignored.length
      );
      reset.addEventListener("click", () => {
        if (!window.confirm(
          `Clear folder sync for “${section.name}”? This removes its folder rules, New-only baseline, and Ignored LoRAs.`,
        )) return;
        const current = sectionById(node, sectionId);
        if (!current) return;
        current.folder_sync = normalizeSectionSync();
        draft = normalizeSectionSync();
        node.__apexFolderSyncErrors?.delete(sectionId);
        commit(node, { fullPresetDirty: true, folderSyncDirty: true });
        setStatus(node, `Cleared folder sync for “${current.name}”.`);
        renderPanel();
      });
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "apex-primary-action";
      apply.textContent = "Apply changes";
      apply.disabled = busy || !dirty || (
        draft.enabled && draft.include_folders.length === 0
      );
      apply.title = draft.enabled && draft.include_folders.length === 0
        ? "Select at least one folder before enabling synchronization"
        : "Save this section’s folder-sync configuration";
      apply.addEventListener("click", () => {
        const current = sectionById(node, sectionId);
        if (!current) return;
        const previous = normalizeSectionSync(current.folder_sync);
        let next = normalizeSectionSync(draft);
        const rulesChanged = (
          JSON.stringify(previous.include_folders) !== JSON.stringify(next.include_folders)
          || JSON.stringify(previous.exclude_folders) !== JSON.stringify(next.exclude_folders)
          || (next.mode === "new" && previous.mode !== "new")
        );
        if (next.mode === "new" && rulesChanged) {
          next = resetSectionSyncBaseline(
            next,
            activeCatalog.loras,
            node.__apexState.folder_filters,
          );
        }
        current.folder_sync = next;
        draft = normalizeSectionSync(next);
        node.__apexFolderSyncErrors?.delete(sectionId);
        commit(node, { fullPresetDirty: true, folderSyncDirty: true });
        setStatus(node, `Updated folder sync for “${current.name}”.`);
        renderPanel();
      });
      configButtons.append(reset, apply);
      configActions.append(configState, configButtons);
      body.appendChild(configActions);

      const pendingPanel = document.createElement("section");
      pendingPanel.className = "apex-folder-sync-pending";
      const pendingHeading = document.createElement("div");
      pendingHeading.className = "apex-folder-sync-heading apex-folder-sync-pending-heading";
      const pendingTitle = document.createElement("div");
      pendingTitle.className = "apex-folder-sync-pending-title";
      const pendingLabel = document.createElement("span");
      pendingLabel.className = "apex-folder-sync-label";
      pendingLabel.textContent = live.mode === "new" ? "New LoRAs" : "Missing LoRAs";
      const pendingCount = document.createElement("span");
      pendingCount.className = `apex-folder-sync-pending-count${status.actionable.length ? " active" : ""}`;
      pendingCount.textContent = `${status.actionable.length} pending`;
      pendingTitle.append(pendingLabel, pendingCount);
      const sync = document.createElement("button");
      sync.type = "button";
      sync.className = "apex-folder-sync-run apex-primary-action";
      sync.textContent = busy ? "Syncing…" : "Sync";
      sync.disabled = busy || dirty || !live.enabled || status.actionable.length === 0;
      const pendingActions = document.createElement("div");
      pendingActions.className = "apex-folder-sync-pending-actions";
      const autoSync = document.createElement("label");
      autoSync.className = "apex-folder-sync-auto";
      const autoSyncInput = document.createElement("input");
      autoSyncInput.type = "checkbox";
      autoSyncInput.checked = live.auto_sync;
      autoSyncInput.disabled = busy || dirty || !live.enabled;
      const autoSyncTrack = document.createElement("span");
      autoSyncTrack.className = "apex-folder-sync-auto-track";
      const autoSyncLabel = document.createElement("span");
      autoSyncLabel.textContent = "Auto";
      autoSync.title = dirty
        ? "Apply the pending configuration changes before changing Auto Sync"
        : live.enabled
          ? "Automatically verify and add detected LoRAs as disabled rows after a refresh"
          : "Enable folder sync before enabling Auto Sync";
      autoSyncInput.addEventListener("change", () => {
        const current = sectionById(node, sectionId);
        if (!current) return;
        const next = normalizeSectionSync(current.folder_sync);
        next.auto_sync = autoSyncInput.checked;
        current.folder_sync = normalizeSectionSync(next);
        draft = normalizeSectionSync(current.folder_sync);
        commit(node, { fullPresetDirty: true, folderSyncDirty: true });
        setStatus(
          node,
          autoSyncInput.checked
            ? `Auto Sync enabled for “${current.name}”.`
            : `Auto Sync disabled for “${current.name}”.`,
        );
        renderPanel();
      });
      autoSync.append(autoSyncInput, autoSyncTrack, autoSyncLabel);
      pendingActions.append(autoSync, sync);
      pendingHeading.append(pendingTitle, pendingActions);
      const pendingList = document.createElement("div");
      pendingList.className = "apex-folder-sync-items apex-folder-sync-pending-list";
      if (!status.actionable.length) {
        const empty = document.createElement("div");
        empty.className = "apex-folder-sync-empty";
        empty.textContent = live.enabled
          ? "This section is up to date."
          : "Enable a mode and apply it to begin detecting LoRAs.";
        pendingList.appendChild(empty);
      } else {
        for (const loraName of status.actionable) {
          const item = document.createElement("div");
          const itemError = status.errors.get(loraName) || "";
          item.className = `apex-folder-sync-item${itemError ? " error" : ""}`;
          const copy = document.createElement("div");
          copy.className = "apex-folder-sync-item-copy";
          const name = document.createElement("div");
          name.className = "apex-folder-sync-item-name";
          name.appendChild(loraNameContent(loraName, node.__apexState.settings));
          name.title = itemError || loraName;
          copy.appendChild(name);
          if (itemError) {
            const error = document.createElement("div");
            error.className = "apex-folder-sync-item-error";
            error.textContent = itemError;
            error.title = itemError;
            copy.appendChild(error);
          }
          const ignore = document.createElement("button");
          ignore.type = "button";
          ignore.textContent = "Ignore";
          ignore.disabled = busy || dirty;
          ignore.addEventListener("click", async () => {
            const operation = beginOperation();
            busy = true;
            renderPanel();
            let identity = { name: loraName, sha256: "", size: 0 };
            try {
              const [identified] = await identifyNames([loraName]);
              if (identified) identity = identified;
            } catch {
              // A name-only ignored entry still prevents the UI from fighting
              // a deliberate choice when a file vanishes during the action.
            }
            if (!operationIsCurrent(operation)) {
              abandonOperation(operation);
              return;
            }
            const current = operation.section;
            let next = addIgnoredIdentity(current.folder_sync, identity);
            if (next.mode === "new") next = markSectionSyncSeen(next, [loraName]);
            current.folder_sync = next;
            node.__apexFolderSyncErrors?.get(sectionId)?.delete(loraName);
            busy = false;
            draft = normalizeSectionSync(next);
            commit(node, { fullPresetDirty: true, folderSyncDirty: true });
            setStatus(node, `Ignored “${splitName(loraName).file}” for “${current.name}”.`);
            renderPanel();
          });
          item.append(copy, ignore);
          pendingList.appendChild(item);
        }
      }
      pendingPanel.append(pendingHeading, pendingList);
      body.appendChild(pendingPanel);

      sync.addEventListener("click", async () => {
        const current = sectionById(node, sectionId);
        if (!current) return;
        const names = sectionSyncStatus(node, sectionId).actionable;
        if (!names.length) return;
        const operation = beginOperation();
        busy = true;
        renderPanel();
        setStatus(node, `Verifying ${names.length} folder-sync LoRA${names.length === 1 ? "" : "s"}…`);
        let progressStatus = node.__apexStatus;
        const resolved = await resolveSectionSyncNames(
          names,
          (completed, total) => {
            if (!operationIsCurrent(operation)) return false;
            setStatus(node, `Verifying folder-sync LoRAs ${completed}/${total}…`);
            progressStatus = node.__apexStatus;
            return true;
          },
        );
        if (!operationIsCurrent(operation)) {
          abandonOperation(operation, progressStatus);
          return;
        }
        const syncResult = applySectionSyncResolution(
          node,
          sectionId,
          names,
          resolved,
          (catalogCache || catalog).loras,
        );
        busy = false;
        const currentSection = sectionById(node, sectionId);
        if (!currentSection || syncResult.aborted) {
          abandonOperation(operation, progressStatus);
          return;
        }
        draft = normalizeSectionSync(currentSection.folder_sync);
        const result = [
          `${syncResult.added} added`,
          syncResult.renamed ? `${syncResult.renamed} renamed` : "",
          syncResult.failed ? `${syncResult.failed} failed` : "",
        ].filter(Boolean).join(", ");
        setStatus(
          node,
          `Folder sync for “${currentSection.name}”: ${result || "no changes"}.`,
          syncResult.failed > 0,
        );
        renderPanel();
      });

      const ignoredDetails = document.createElement("details");
      ignoredDetails.className = "apex-folder-sync-ignored";
      const ignoredSummary = document.createElement("summary");
      ignoredSummary.textContent = `Ignored LoRAs (${live.ignored.length})`;
      ignoredDetails.appendChild(ignoredSummary);
      const ignoredList = document.createElement("div");
      ignoredList.className = "apex-folder-sync-items";
      if (!live.ignored.length) {
        const empty = document.createElement("div");
        empty.className = "apex-folder-sync-empty";
        empty.textContent = "No LoRAs are ignored for this section.";
        ignoredList.appendChild(empty);
      } else {
        for (const identity of live.ignored) {
          const item = document.createElement("div");
          item.className = "apex-folder-sync-item ignored";
          const name = document.createElement("div");
          name.className = "apex-folder-sync-item-name";
          name.appendChild(loraNameContent(identity.name, node.__apexState.settings));
          name.title = identity.name;
          const allow = document.createElement("button");
          allow.type = "button";
          allow.textContent = "Allow again";
          allow.disabled = busy || dirty;
          allow.addEventListener("click", () => {
            const current = sectionById(node, sectionId);
            if (!current) return;
            allowSectionSyncIdentity(current, identity);
            draft = normalizeSectionSync(current.folder_sync);
            commit(node, { fullPresetDirty: true, folderSyncDirty: true });
            setStatus(node, `Allowed “${splitName(identity.name).file}” for folder sync.`);
            renderPanel();
          });
          item.append(name, allow);
          ignoredList.appendChild(item);
        }
      }
      ignoredDetails.appendChild(ignoredList);
      body.appendChild(ignoredDetails);
    };

    openPopover.refresh = renderPanel;
    renderPanel();
    setStatus(node, "");
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


function showNodeSettings(node, anchor) {
  const { panel, close } = createPopover(anchor, "Node settings", "apex-settings-popover");
  const settings = normalizeSettings(node.__apexState.settings);
  const fields = document.createElement("div");
  fields.className = "apex-settings-list";

  const toggle = (text, checked) => {
    const label = document.createElement("label");
    label.className = "apex-setting-row";
    const name = document.createElement("span");
    name.textContent = text;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    label.append(name, input);
    fields.appendChild(label);
    return input;
  };

  const showSafetensors = toggle("Show .safetensors", settings.show_safetensors);
  const showFolderPaths = toggle("Show folder paths", settings.show_folder_paths);
  const showTriggerButton = toggle("Show trigger-word button", settings.show_trigger_button);
  const stepRow = document.createElement("label");
  stepRow.className = "apex-setting-row";
  const stepLabel = document.createElement("span");
  stepLabel.textContent = "Strength per drag tick";
  const dragStep = document.createElement("input");
  dragStep.className = "apex-setting-number";
  dragStep.type = "number";
  dragStep.min = "0.01";
  dragStep.max = "100";
  dragStep.step = "0.01";
  dragStep.value = String(settings.strength_drag_step);
  dragStep.title = `Exact strength change per ${STRENGTH_DRAG_PIXELS_PER_TICK} horizontal pixels`;
  stepRow.append(stepLabel, dragStep);
  fields.appendChild(stepRow);
  const delayRow = document.createElement("label");
  delayRow.className = "apex-setting-row";
  const delayLabel = document.createElement("span");
  delayLabel.textContent = "Run on change delay (ms)";
  const autoQueueDelay = document.createElement("input");
  autoQueueDelay.className = "apex-setting-number";
  autoQueueDelay.type = "number";
  autoQueueDelay.min = "0";
  autoQueueDelay.max = "5000";
  autoQueueDelay.step = "50";
  autoQueueDelay.value = String(settings.run_on_change_delay_ms);
  autoQueueDelay.title = "Wait after a committed LoRA change before queueing; 0 queues immediately";
  delayRow.append(delayLabel, autoQueueDelay);
  fields.appendChild(delayRow);
  const scaleRow = document.createElement("label");
  scaleRow.className = "apex-setting-row";
  const scaleLabel = document.createElement("span");
  scaleLabel.textContent = "Overlay scale (%)";
  const overlayScale = document.createElement("input");
  overlayScale.className = "apex-setting-number";
  overlayScale.type = "number";
  overlayScale.min = "50";
  overlayScale.max = "100";
  overlayScale.step = "1";
  overlayScale.value = String(Math.round(settings.overlay_scale * 100));
  overlayScale.title = "Scale the complete fixed editor and its popups";
  scaleRow.append(scaleLabel, overlayScale);
  fields.appendChild(scaleRow);

  const actions = document.createElement("div");
  actions.className = "apex-popover-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.className = "apex-primary-action";
  actions.append(reset, apply);
  const savedData = document.createElement("details");
  savedData.className = "apex-saved-data";
  const savedSummary = document.createElement("summary");
  savedSummary.textContent = "Saved LoRA data";
  const savedEntries = document.createElement("div");
  savedEntries.className = "apex-saved-data-list";
  savedEntries.textContent = "Loading...";
  savedData.append(savedSummary, savedEntries);
  const dangerZone = document.createElement("div");
  dangerZone.className = "apex-danger-zone";
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "apex-danger-button";
  clearAll.textContent = "Clear all saved LoRA data";
  clearAll.disabled = true;
  dangerZone.appendChild(clearAll);
  panel.append(fields, actions, savedData, dangerZone);

  let metadataEntries = [];
  let metadataVisible = 100;
  const renderMetadata = () => {
    savedSummary.textContent = `Saved LoRA data (${metadataEntries.length})`;
    clearAll.disabled = metadataEntries.length === 0;
    savedEntries.replaceChildren();
    for (const entry of metadataEntries.slice(0, metadataVisible)) {
      const row = document.createElement("div");
      row.className = "apex-saved-data-row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.name;
      name.title = entry.name;
      const hash = document.createElement("code");
      hash.textContent = entry.sha256.slice(0, 10);
      hash.title = entry.sha256;
      const trigger = document.createElement("span");
      const triggerMetadata = normalizeTriggerMetadata(entry);
      const savedCount = triggerMetadata.trigger_words.length;
      const activeCount = triggerMetadata.active_trigger_words.length;
      trigger.className = `trigger${savedCount ? "" : " empty"}`;
      trigger.textContent = savedCount
        ? `${activeCount}/${savedCount} active${activeCount ? `: ${triggerMetadata.active_trigger_words.join(", ")}` : ""}`
        : "No trigger words";
      trigger.title = savedCount
        ? `Active (${activeCount}): ${triggerMetadata.active_trigger_words.join(", ") || "None"}\nSaved: ${triggerMetadata.trigger_words.join("\n")}`
        : "No trigger words saved";
      const remove = iconButton(
        "trash",
        `Delete the saved identity and trigger words for "${entry.name}"`,
        "apex-saved-data-delete",
      );
      remove.setAttribute("aria-label", `Delete saved LoRA data for ${entry.name}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await fetchJson(`/apex_lora_loader/metadata/${encodeURIComponent(entry.sha256)}`, {
            method: "DELETE",
          });
          metadataEntries = metadataEntries.filter((item) => item.sha256 !== entry.sha256);
          metadataCache = metadataEntries;
          clearOpenTriggerMetadata(entry.sha256);
          renderMetadata();
          setStatus(
            node,
            `Deleted saved data for "${entry.name}" and cleared its triggers from open Apex rows. The LoRA file was not deleted; its identity may be recreated when used again.`,
          );
        } catch (error) {
          remove.disabled = false;
          setStatus(node, error.message, true);
        }
      });
      row.append(name, hash, remove, trigger);
      savedEntries.appendChild(row);
    }
    if (metadataEntries.length > metadataVisible) {
      const remaining = metadataEntries.length - metadataVisible;
      const more = document.createElement("button");
      more.type = "button";
      more.className = "apex-saved-data-more";
      more.textContent = `Show more (${remaining} remaining)`;
      more.addEventListener("click", () => {
        metadataVisible += 100;
        renderMetadata();
      });
      savedEntries.appendChild(more);
    }
    if (!metadataEntries.length) {
      savedEntries.textContent = "No LoRA identities have been saved yet.";
    }
  };

  loadMetadata().then((entries) => {
    if (!panel.isConnected) return;
    metadataEntries = entries;
    renderMetadata();
  }).catch((error) => {
    if (!panel.isConnected) return;
    savedEntries.textContent = error.message;
  });

  clearAll.addEventListener("click", async () => {
    const count = metadataEntries.length;
    const noun = count === 1 ? "record" : "records";
    const confirmed = window.confirm(
      `Clear all saved LoRA data?\n\nThis deletes ${count} saved LoRA identity ${noun} and every trigger word stored with them. Trigger words will also be cleared from Apex nodes in the currently open workflow.\n\nLoRA files, stack rows, sections, presets, and folder settings are not deleted. Identity records will be recreated as LoRAs are identified again. Deleted trigger words cannot be recovered unless another workflow still contains them; opening that workflow can save them again.\n\nContinue?`,
    );
    if (!confirmed) return;
    clearAll.disabled = true;
    try {
      const result = await fetchJson("/apex_lora_loader/metadata", { method: "DELETE" });
      const deleted = Number.isInteger(result.deleted) ? result.deleted : count;
      const deletedNoun = deleted === 1 ? "record" : "records";
      const triggerPronoun = deleted === 1 ? "its" : "their";
      metadataEntries = [];
      metadataVisible = 100;
      metadataCache = [];
      clearOpenTriggerMetadata();
      renderMetadata();
      setStatus(
        node,
        `Cleared ${deleted} saved LoRA ${deletedNoun} and ${triggerPronoun} trigger words. LoRA files, presets, and stack rows were not deleted; identity records will rebuild as needed.`,
      );
    } catch (error) {
      clearAll.disabled = false;
      setStatus(node, error.message, true);
    }
  });

  reset.addEventListener("click", () => {
    showSafetensors.checked = DEFAULT_SETTINGS.show_safetensors;
    showFolderPaths.checked = DEFAULT_SETTINGS.show_folder_paths;
    showTriggerButton.checked = DEFAULT_SETTINGS.show_trigger_button;
    dragStep.value = String(DEFAULT_SETTINGS.strength_drag_step);
    autoQueueDelay.value = String(DEFAULT_SETTINGS.run_on_change_delay_ms);
    overlayScale.value = String(Math.round(DEFAULT_SETTINGS.overlay_scale * 100));
  });
  apply.addEventListener("click", () => {
    const step = Number(dragStep.value);
    if (!Number.isFinite(step) || step < 0.01 || step > 100) {
      setStatus(node, "Strength drag step must be between 0.01 and 100.", true);
      dragStep.focus();
      return;
    }
    const delayMs = Number(autoQueueDelay.value);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5000) {
      setStatus(node, "Run on change delay must be between 0 and 5000 milliseconds.", true);
      autoQueueDelay.focus();
      return;
    }
    const scalePercent = Number(overlayScale.value);
    if (!Number.isFinite(scalePercent) || scalePercent < 50 || scalePercent > 100) {
      setStatus(node, "Overlay scale must be between 50% and 100%.", true);
      overlayScale.focus();
      return;
    }
    node.__apexState.settings = normalizeSettings({
      show_safetensors: showSafetensors.checked,
      show_folder_paths: showFolderPaths.checked,
      show_trigger_button: showTriggerButton.checked,
      strength_drag_step: step,
      run_on_change_delay_ms: delayMs,
      overlay_scale: scalePercent / 100,
    });
    commit(node, { fullPresetDirty: true });
    close();
    setStatus(node, "Node settings updated.");
  });
}


function updateOpenTriggerMetadata(sha256, value, deferredNode = null) {
  const normalized = sha256.toLocaleLowerCase();
  for (const node of app.graph?._nodes || []) {
    if ((node.comfyClass || node.type) !== NODE_CLASS || !node.__apexState) continue;
    let changed = false;
    for (const row of allRows(node.__apexState)) {
      if (row.sha256.toLocaleLowerCase() !== normalized) continue;
      changed = applyTriggerMetadata(row, value) || changed;
    }
    if (changed && node !== deferredNode) commit(node, { fullPresetDirty: true });
  }
}


function clearOpenTriggerMetadata(sha256 = null) {
  const normalized = sha256?.toLocaleLowerCase() || null;
  for (const node of app.graph?._nodes || []) {
    if ((node.comfyClass || node.type) !== NODE_CLASS || !node.__apexState) continue;
    let changed = false;
    for (const row of allRows(node.__apexState)) {
      if (normalized !== null && row.sha256.toLocaleLowerCase() !== normalized) continue;
      changed = applyTriggerMetadata(row, {}) || changed;
    }
    if (changed) commit(node, { fullPresetDirty: true });
  }
}


async function showTriggerEditor(node, anchor, rowId) {
  try {
    let row = rowById(node, rowId);
    if (!row) return;
    let identifyingStatus = null;
    if (!/^[0-9a-f]{64}$/i.test(row.sha256) || !Number.isInteger(row.size)) {
      setStatus(node, `Identifying ${splitName(row.name).file}…`);
      identifyingStatus = node.__apexStatus;
      const [identity] = await identifyNames([row.name]);
      if (!identity) throw new Error("The selected LoRA could not be identified.");
      Object.assign(row, identity);
      applyTriggerMetadata(row, identity);
      commit(node, { presetDirty: false, render: false });
    }

    row = rowById(node, rowId);
    if (!row || !editorAnchorIsActive(node, anchor)) {
      if (identifyingStatus && node.__apexStatus === identifyingStatus) setStatus(node, "");
      return;
    }
    let draft = normalizeTriggerMetadata(row);
    let draftPosition = normalizeTriggerPosition(row.trigger_position);
    const { panel, close } = createPopover(anchor, "Trigger words", "apex-trigger-popover");
    const identity = document.createElement("div");
    identity.className = "apex-trigger-identity";
    const name = document.createElement("span");
    name.textContent = row.name;
    name.title = row.name;
    const hash = document.createElement("code");
    hash.textContent = row.sha256.slice(0, 12);
    hash.title = row.sha256;
    identity.append(name, hash);
    const placement = document.createElement("div");
    placement.className = "apex-trigger-placement";
    placement.title = "Prepend adds active trigger words before the incoming prompt; Append adds them after it.";
    const placementLabel = document.createElement("span");
    placementLabel.textContent = "Trigger placement";
    const placementButtons = document.createElement("div");
    placementButtons.className = "apex-trigger-placement-buttons";
    const prepend = document.createElement("button");
    prepend.type = "button";
    prepend.textContent = "Prepend";
    const append = document.createElement("button");
    append.type = "button";
    append.textContent = "Append";
    placementButtons.append(prepend, append);
    placement.append(placementLabel, placementButtons);
    const chips = document.createElement("div");
    chips.className = "apex-trigger-chips";
    const addRow = document.createElement("div");
    addRow.className = "apex-trigger-add-row";
    const input = document.createElement("input");
    input.className = "apex-trigger-input";
    input.type = "text";
    input.maxLength = 2000;
    input.placeholder = "Add a trigger word or phrase";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add";
    add.disabled = true;
    addRow.append(input, add);
    const actions = document.createElement("div");
    actions.className = "apex-popover-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.className = "apex-primary-action";
    actions.append(save);
    panel.append(identity, placement, chips, addRow, actions);

    const renderPlacement = () => {
      prepend.classList.toggle("active", draftPosition === "prepend");
      append.classList.toggle("active", draftPosition === "append");
      prepend.setAttribute("aria-pressed", String(draftPosition === "prepend"));
      append.setAttribute("aria-pressed", String(draftPosition === "append"));
    };
    prepend.addEventListener("click", () => {
      draftPosition = "prepend";
      renderPlacement();
    });
    append.addEventListener("click", () => {
      draftPosition = "append";
      renderPlacement();
    });

    const renderChips = () => {
      chips.replaceChildren();
      if (!draft.trigger_words.length) {
        const empty = document.createElement("div");
        empty.className = "apex-trigger-empty";
        empty.textContent = "No trigger words saved.";
        chips.appendChild(empty);
        return;
      }
      for (const word of draft.trigger_words) {
        const isActive = draft.active_trigger_words.includes(word);
        const chip = document.createElement("div");
        chip.className = `apex-trigger-chip${isActive ? " active" : ""}`;
        const select = document.createElement("button");
        select.type = "button";
        select.className = "apex-trigger-chip-label";
        select.textContent = word;
        select.title = isActive
          ? `Deactivate trigger "${word}"`
          : `Activate trigger "${word}"`;
        select.setAttribute("aria-pressed", String(isActive));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "apex-trigger-chip-remove";
        remove.textContent = "×";
        remove.title = `Remove "${word}"`;
        remove.setAttribute("aria-label", `Remove ${word}`);
        select.addEventListener("click", () => {
          draft = toggleTriggerWord(draft, word);
          renderChips();
        });
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          draft = removeTriggerWord(draft, word);
          renderChips();
        });
        chip.append(select, remove);
        chips.appendChild(chip);
      }
    };

    const addInputWord = () => {
      const value = input.value.trim();
      if (!value) return;
      draft = addTriggerWord(draft, value);
      input.value = "";
      add.disabled = true;
      renderChips();
      input.focus();
    };

    const saveTriggerWords = async () => {
      if (save.disabled) return;
      try {
        add.disabled = true;
        save.disabled = true;
        const saved = await fetchJson(
          `/apex_lora_loader/metadata/${encodeURIComponent(row.sha256)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: row.name,
              size: row.size,
              trigger_words: draft.trigger_words,
              active_trigger_words: draft.active_trigger_words,
            }),
          },
        );
        metadataCache = null;
        close();
        const savedMetadata = normalizeTriggerMetadata(saved);
        row.trigger_position = draftPosition;
        applyTriggerMetadata(row, savedMetadata);
        updateOpenTriggerMetadata(saved.sha256, savedMetadata, node);
        commit(node, { fullPresetDirty: true });
        const count = savedMetadata.trigger_words.length;
        setStatus(
          node,
          count
            ? `Saved ${count} trigger word${count === 1 ? "" : "s"} for "${splitName(saved.name).file}".`
            : `Cleared trigger words for "${splitName(saved.name).file}".`,
        );
      } catch (error) {
        add.disabled = !input.value.trim();
        save.disabled = false;
        setStatus(node, error.message, true);
      }
    };
    add.addEventListener("click", addInputWord);
    save.addEventListener("click", saveTriggerWords);
    input.addEventListener("input", () => { add.disabled = !input.value.trim(); });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addInputWord();
    });
    renderPlacement();
    renderChips();
    setTimeout(() => input.focus(), 20);
    setStatus(node, "");
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


async function resolveNodeLoras(node, force = false) {
  const rows = allRows(node.__apexState);
  let catalogReloaded = false;
  try {
    if (force) {
      await loadCatalog(true);
      catalogReloaded = true;
    }
    if (!rows.length) {
      invalidateSectionSync(node);
      if (force) {
        refreshAllSectionSyncStatuses();
        setStatus(node, "LoRA list refreshed.");
        await queueAutoSyncPass([node]);
      }
      else refreshNodeSectionSyncStatus(node, true);
      return;
    }
    setStatus(node, force ? "Refreshing and verifying LoRAs…" : "Checking LoRA names…");
    const data = { entries: [], errors: [] };
    for (let index = 0; index < rows.length; index += 512) {
      const batch = rows.slice(index, index + 512);
      const result = await fetchJson("/apex_lora_loader/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: batch.map(
            ({ id, name, sha256, size, trigger_words, active_trigger_words }) => ({
              id,
              name,
              sha256,
              size,
              trigger_words,
              active_trigger_words,
            }),
          ),
          force,
        }),
      });
      data.entries.push(...(result.entries || []));
      data.errors.push(...(result.errors || []));
      if (rows.length > 512) {
        const completed = Math.min(index + batch.length, rows.length);
        setStatus(
          node,
          `${force ? "Refreshing and verifying" : "Checking"} LoRAs ${completed}/${rows.length}…`,
        );
      }
    }
    if (data.entries?.length) metadataCache = null;
    let renamed = 0;
    let stateChanged = false;
    let contentChanged = false;
    let syncChanged = false;
    for (const identity of data.entries || []) {
      const row = rowById(node, identity.id);
      if (!row) continue;
      const section = node.__apexState.sections.find((item) => item.loras.includes(row));
      const previousIdentity = rowIdentity(row);
      if (identity.renamed && row.name !== identity.name) renamed += 1;
      if (
        row.name !== identity.name ||
        row.sha256 !== identity.sha256 ||
        row.size !== identity.size ||
        !sameTriggerMetadata(row, identity)
      ) {
        stateChanged = true;
      }
      if (row.sha256 !== identity.sha256) contentChanged = true;
      row.name = identity.name;
      row.sha256 = identity.sha256;
      row.size = identity.size;
      applyTriggerMetadata(row, identity);
      delete row.error;
      if (section) {
        syncChanged = migrateSectionSyncIdentity(
          section,
          previousIdentity,
          rowIdentity(row),
        ) || syncChanged;
      }
    }
    for (const item of data.errors || []) {
      const row = rowById(node, item.id);
      if (row) row.error = item.error;
    }
    if (stateChanged || syncChanged) {
      commit(node, {
        presetDirty: contentChanged,
        folderSyncDirty: true,
      });
    } else {
      invalidateSectionSync(node);
      renderNode(node);
    }
    openPopover?.refresh?.();
    const errors = data.errors?.length || 0;
    if (errors) setStatus(node, `${errors} LoRA${errors === 1 ? " is" : "s are"} missing.`, true);
    else if (renamed) setStatus(node, `Updated ${renamed} renamed LoRA${renamed === 1 ? "" : "s"}.`);
    else setStatus(node, force ? "LoRAs refreshed and verified." : "");
    if (force) {
      refreshAllSectionSyncStatuses();
      await queueAutoSyncPass([node]);
    }
  } catch (error) {
    setStatus(node, error.message, true);
    if (force && catalogReloaded) refreshAllSectionSyncStatuses();
  }
}


async function ensurePresetIdentities(node, includeDisabled = false) {
  const rows = allRows(node.__apexState).filter((row) =>
    (includeDisabled || row.enabled)
    && (!/^[0-9a-f]{64}$/i.test(row.sha256) || !Number.isInteger(row.size)),
  );
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += 512) {
    const batch = rows.slice(index, index + 512);
    const identities = await identifyNames(batch.map((row) => row.name));
    if (identities.length !== batch.length) {
      throw new Error("Not every LoRA could be identified for this preset.");
    }
    identities.forEach((identity, identityIndex) => {
      Object.assign(batch[identityIndex], identity);
      applyTriggerMetadata(batch[identityIndex], identity);
    });
  }
  commit(node, { presetDirty: false, render: false });
}


function publishPresets(presets, sourceNode = null) {
  presetsCache = presets;
  const nodes = new Set(app.graph?._nodes || []);
  if (sourceNode) nodes.add(sourceNode);
  for (const node of nodes) {
    if (!node.__apexState || !node.__apexRoot) continue;
    node.__apexPresets = presets;
    renderNode(node);
  }
}


async function refreshPresetNodes(activeId = null) {
  presetsCache = null;
  const presets = await loadPresets(true);
  if (activeId && app.canvas?.current_node?.__apexState) {
    app.canvas.current_node.__apexState.active_preset_id = activeId;
  }
  publishPresets(presets);
  return presets;
}


function showSavePreset(node, anchor) {
  const current = node.__apexPresets?.find(
    (preset) => preset.id === node.__apexState.active_preset_id,
  );
  let selectedType = presetType(current);
  const { panel, close } = createPopover(anchor, "Save preset", "apex-preset-save");
  const nameLabel = document.createElement("label");
  nameLabel.className = "apex-preset-name-field";
  const nameCaption = document.createElement("span");
  nameCaption.textContent = "Preset name";
  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 100;
  name.value = current?.name || "";
  name.placeholder = "Name this preset";
  nameLabel.append(nameCaption, name);

  const typeLabel = document.createElement("span");
  typeLabel.className = "apex-preset-type-label";
  typeLabel.textContent = "What should be saved?";
  const types = document.createElement("div");
  types.className = "apex-preset-types";
  const typeButtons = new Map();
  for (const [type, title, description] of [
    ["active", "Active states only", "Enabled LoRAs and strengths only. Your current stack stays intact when applied."],
    ["full", "Full setup", "Folders, settings, sections, LoRA order, states, strengths, and trigger configuration."],
  ]) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "apex-preset-type";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = description;
    option.append(heading, detail);
    option.addEventListener("click", () => {
      selectedType = type;
      for (const [value, button] of typeButtons) {
        const active = value === selectedType;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      }
    });
    typeButtons.set(type, option);
    types.appendChild(option);
  }
  typeButtons.get(selectedType)?.click();

  const actions = document.createElement("div");
  actions.className = "apex-popover-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save preset";
  save.className = "apex-primary-action";
  actions.append(cancel, save);
  panel.append(nameLabel, typeLabel, types, actions);
  cancel.addEventListener("click", close);

  const saveCurrentPreset = async () => {
    if (save.disabled) return;
    const presetName = name.value.trim();
    if (!presetName) {
      name.focus();
      setStatus(node, "Preset name cannot be empty.", true);
      return;
    }
    const existing = node.__apexPresets?.find(
      (preset) => preset.name.toLocaleLowerCase() === presetName.toLocaleLowerCase(),
    );
    if (existing && !window.confirm(`Overwrite preset “${existing.name}”?`)) return;
    try {
      save.disabled = true;
      cancel.disabled = true;
      name.disabled = true;
      for (const button of typeButtons.values()) button.disabled = true;
      setStatus(node, selectedType === "full" ? "Preparing full setup preset…" : "Preparing active LoRA preset…");
      await ensurePresetIdentities(node, selectedType === "full");
      const preset = {
        id: existing?.id || current?.id || crypto.randomUUID(),
        name: presetName,
        type: selectedType,
        ...(selectedType === "full"
          ? { state: fullPresetStateFromState(node.__apexState) }
          : { entries: presetEntriesFromState(node.__apexState) }),
      };
      const saved = await fetchJson("/apex_lora_loader/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset),
      });
      close();
      node.__apexState.active_preset_id = saved.id;
      commit(node, { presetDirty: false, render: false });
      const presets = [
        ...(node.__apexPresets || []).filter((preset) => preset.id !== saved.id),
        saved,
      ].sort((left, right) => left.name.localeCompare(right.name));
      publishPresets(presets, node);
      setStatus(
        node,
        `Saved ${presetType(saved) === "full" ? "full setup" : "active LoRA"} preset “${saved.name}”.`,
      );
    } catch (error) {
      save.disabled = false;
      cancel.disabled = false;
      name.disabled = false;
      for (const button of typeButtons.values()) button.disabled = false;
      setStatus(node, error.message, true);
    }
  };
  save.addEventListener("click", saveCurrentPreset);
  name.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveCurrentPreset();
  });
  setTimeout(() => {
    name.focus();
    name.select();
  }, 20);
}


function buildPresetMenuRow(node, preset, close) {
  const row = document.createElement("div");
  const selected = node.__apexState.active_preset_id === preset.id;
  row.className = `apex-preset-menu-row${selected ? " active" : ""}`;

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "apex-preset-menu-apply";
  apply.title = `Apply ${presetType(preset) === "full" ? "full setup" : "active-state"} preset “${preset.name}”`;
  const name = document.createElement("span");
  name.textContent = preset.name;
  apply.appendChild(name);
  apply.addEventListener("click", () => {
    if (applySelectedPreset(node, preset.id)) close();
  });

  const rename = iconButton(
    "pencil",
    `Rename preset “${preset.name}”`,
    "apex-preset-row-action apex-preset-rename",
  );
  const remove = iconButton(
    "trash",
    `Delete preset “${preset.name}”`,
    "apex-preset-row-action apex-preset-delete",
  );
  let renameInput = null;
  let busy = false;

  const finishRename = async () => {
    if (!renameInput || busy) return;
    const nextName = renameInput.value.trim();
    if (!nextName) {
      renameInput.focus();
      setStatus(node, "Preset name cannot be empty.", true);
      return;
    }
    if (nextName === preset.name) {
      renameInput.replaceWith(apply);
      renameInput = null;
      rename.classList.remove("active");
      rename.title = `Rename preset “${preset.name}”`;
      remove.disabled = false;
      return;
    }
    busy = true;
    renameInput.disabled = true;
    rename.disabled = true;
    try {
      const updated = await fetchJson(`/apex_lora_loader/presets/${encodeURIComponent(preset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const presets = [
        ...(node.__apexPresets || []).filter((item) => item.id !== updated.id),
        updated,
      ].sort((left, right) => left.name.localeCompare(right.name));
      close();
      publishPresets(presets, node);
      setStatus(node, `Renamed preset to “${updated.name}”.`);
    } catch (error) {
      busy = false;
      renameInput.disabled = false;
      rename.disabled = false;
      renameInput.focus();
      setStatus(node, error.message, true);
    }
  };

  rename.addEventListener("click", (event) => {
    event.stopPropagation();
    if (renameInput) {
      finishRename();
      return;
    }
    renameInput = document.createElement("input");
    renameInput.className = "apex-preset-rename-input";
    renameInput.type = "text";
    renameInput.maxLength = 100;
    renameInput.value = preset.name;
    apply.replaceWith(renameInput);
    rename.classList.add("active");
    rename.title = "Save preset name";
    remove.disabled = true;
    renameInput.addEventListener("keydown", (inputEvent) => {
      if (inputEvent.key === "Enter") {
        inputEvent.preventDefault();
        finishRename();
      } else if (inputEvent.key === "Escape") {
        inputEvent.preventDefault();
        renameInput.replaceWith(apply);
        renameInput = null;
        rename.classList.remove("active");
        rename.title = `Rename preset “${preset.name}”`;
        remove.disabled = false;
        rename.focus();
      }
    });
    setTimeout(() => {
      renameInput?.focus();
      renameInput?.select();
    }, 0);
  });

  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (busy || !window.confirm(`Delete preset “${preset.name}”?`)) return;
    busy = true;
    rename.disabled = true;
    remove.disabled = true;
    try {
      await fetchJson(`/apex_lora_loader/presets/${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
      });
      const presetNodes = new Set(app.graph?._nodes || []);
      presetNodes.add(node);
      for (const presetNode of presetNodes) {
        if (presetNode.__apexState?.active_preset_id !== preset.id) continue;
        presetNode.__apexState.active_preset_id = null;
        commit(presetNode, { presetDirty: false, render: false });
      }
      const presets = (node.__apexPresets || []).filter((item) => item.id !== preset.id);
      close();
      publishPresets(presets, node);
      setStatus(node, `Deleted preset “${preset.name}”.`);
    } catch (error) {
      busy = false;
      rename.disabled = false;
      remove.disabled = false;
      setStatus(node, error.message, true);
    }
  });

  row.append(apply, rename, remove);
  return row;
}


function showPresetDropdown(node, anchor) {
  const { panel, close } = createPopover(anchor, "Presets", "apex-preset-dropdown");
  const list = document.createElement("div");
  list.className = "apex-preset-menu";
  const selectedPreset = node.__apexPresets?.some(
    (preset) => preset.id === node.__apexState.active_preset_id,
  );
  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = `apex-preset-custom${selectedPreset ? "" : " active"}`;
  const customName = document.createElement("span");
  customName.textContent = "Custom";
  custom.appendChild(customName);
  custom.addEventListener("click", () => {
    close();
    applySelectedPreset(node, "");
  });
  list.appendChild(custom);

  for (const [type, label] of [
    ["active", "Active-state presets"],
    ["full", "Full setup presets"],
  ]) {
    const presets = (node.__apexPresets || []).filter((preset) => presetType(preset) === type);
    if (!presets.length) continue;
    const group = document.createElement("section");
    group.className = "apex-preset-menu-group";
    const heading = document.createElement("div");
    heading.className = "apex-preset-menu-heading";
    const title = document.createElement("span");
    title.textContent = label;
    const count = document.createElement("small");
    count.textContent = String(presets.length);
    heading.append(title, count);
    group.appendChild(heading);
    for (const preset of presets) group.appendChild(buildPresetMenuRow(node, preset, close));
    list.appendChild(group);
  }
  if (!(node.__apexPresets || []).length) {
    const empty = document.createElement("div");
    empty.className = "apex-preset-menu-empty";
    empty.textContent = "No presets saved yet.";
    list.appendChild(empty);
  }
  panel.appendChild(list);
}


function applySelectedPreset(node, presetId) {
  const preset = node.__apexPresets?.find((item) => item.id === presetId);
  if (!preset) {
    node.__apexState.active_preset_id = null;
    commit(node, { presetDirty: false });
    return true;
  }
  if (
    presetType(preset) === "full"
    && !window.confirm(
      `Apply full setup preset “${preset.name}”?\n\nThis will replace the current folder filters, node settings, sections, folder-sync rules, LoRA rows, ordering, enabled states, strengths, and trigger-word configuration.\n\nContinue?`,
    )
  ) return false;
  if (presetType(preset) === "full") {
    const result = applyFullPreset(node.__apexState, preset);
    node.__apexFolderAutoSyncAdded?.clear?.();
    commit(node, {
      presetDirty: false,
      folderSyncDirty: true,
      clearFolderSyncErrors: true,
    });
    setStatus(
      node,
      `Applied full setup “${preset.name}” with ${result.sections} section${result.sections === 1 ? "" : "s"} and ${result.loras} LoRA${result.loras === 1 ? "" : "s"}.`,
    );
    return true;
  }
  const result = applyPreset(node.__apexState, preset);
  commit(node, { presetDirty: false });
  setStatus(
    node,
    result.missing
      ? `Applied “${preset.name}”; ${result.missing} saved LoRA${result.missing === 1 ? " is" : "s are"} not in this stack.`
      : `Applied preset “${preset.name}”.`,
    false,
  );
  return true;
}


function buildToolbar(node) {
  const toolbar = document.createElement("div");
  toolbar.className = "apex-toolbar";
  const selectedPreset = node.__apexPresets?.find(
    (preset) => preset.id === node.__apexState.active_preset_id,
  );
  const presetMenu = document.createElement("button");
  presetMenu.type = "button";
  presetMenu.className = "apex-preset-select";
  presetMenu.title = selectedPreset
    ? `${presetType(selectedPreset) === "full" ? "Full setup" : "Active-state"} preset: ${selectedPreset.name}`
    : "Custom node state";
  presetMenu.setAttribute("aria-haspopup", "menu");
  const presetLabel = document.createElement("span");
  presetLabel.textContent = selectedPreset?.name || "Custom";
  presetMenu.append(presetLabel, svgIcon("chevronDown"));
  presetMenu.addEventListener("click", () => showPresetDropdown(node, presetMenu));

  const save = iconButton(
    "savePlus",
    "Save active LoRAs or the complete node setup as a global preset",
    "apex-tool",
  );
  save.addEventListener("click", () => showSavePreset(node, save));
  const filters = node.__apexState.folder_filters;
  const folderLabel = filters === null ? "Folders: All" : filters.length ? `Folders: ${filters.length}` : "Folders: None";
  const folders = iconButton(
    "folderCog",
    "Choose which LoRA folders are offered by the picker",
    "apex-tool apex-icon-label",
    folderLabel,
  );
  folders.addEventListener("click", () => showFolderChooser(node, folders));
  const refresh = iconButton("refresh", "Rescan LoRAs and verify content identities", "apex-tool");
  refresh.addEventListener("click", async () => {
    try {
      await refreshPresetNodes();
    } catch (error) {
      setStatus(node, error.message, true);
    }
    await resolveNodeLoras(node, true);
  });
  const settings = iconButton("settings", "Configure this Apex LoRA Loader", "apex-tool apex-tool-divider");
  settings.addEventListener("click", () => showNodeSettings(node, settings));
  const presetTools = document.createElement("div");
  presetTools.className = "apex-toolbar-island apex-toolbar-presets";
  presetTools.append(presetMenu, save);
  const rows = allRows(node.__apexState);
  const enabledRows = rows.filter((row) => row.enabled).length;
  const sectionCount = node.__apexState.sections.length;
  const infoTools = document.createElement("div");
  infoTools.className = "apex-toolbar-island apex-toolbar-info";
  infoTools.title = `${sectionCount} ${sectionCount === 1 ? "section" : "sections"}, ${rows.length} ${rows.length === 1 ? "LoRA" : "LoRAs"}, ${enabledRows} active`;
  infoTools.setAttribute("aria-label", infoTools.title);
  for (const [value, label, className] of [
    [sectionCount, sectionCount === 1 ? "section" : "sections", ""],
    [rows.length, rows.length === 1 ? "LoRA" : "LoRAs", ""],
    [enabledRows, "active", "active"],
  ]) {
    const metric = document.createElement("span");
    metric.className = `apex-toolbar-metric${className ? ` ${className}` : ""}`;
    const number = document.createElement("strong");
    number.textContent = String(value);
    metric.append(number, ` ${label}`);
    infoTools.appendChild(metric);
  }
  const utilityTools = document.createElement("div");
  utilityTools.className = "apex-toolbar-island apex-toolbar-utilities";
  utilityTools.append(folders, refresh, settings);
  toolbar.append(presetTools, infoTools, utilityTools);
  return toolbar;
}


function installStrengthDrag(node, row, input, autoQueue = false) {
  let drag = null;
  let ignoreClick = false;

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const value = parseStrengthInput(input.value);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: value ?? row.strength,
      ticks: 0,
      moved: false,
    };
    input.classList.add("scrubbing");
    input.setPointerCapture(event.pointerId);
  });

  input.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const ticks = Math.trunc(deltaX / STRENGTH_DRAG_PIXELS_PER_TICK);
    if (ticks === drag.ticks) return;
    drag.ticks = ticks;
    if (!drag.moved && ticks === 0) return;
    drag.moved = true;
    event.preventDefault();
    input.classList.add("dragging");
    row.strength = strengthFromDrag(
      drag.startValue,
      deltaX,
      node.__apexState.settings.strength_drag_step,
    );
    input.value = formatStrength(row.strength);
    setStrengthFill(input, row.strength);
  });

  const finish = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    const canceled = event.type === "pointercancel";
    const startValue = drag.startValue;
    drag = null;
    if (moved && document.activeElement === input) input.blur();
    input.classList.remove("dragging", "scrubbing");
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    event.preventDefault();
    ignoreClick = true;
    if (moved && canceled) {
      row.strength = startValue;
      input.value = formatStrength(row.strength);
      setStrengthFill(input, row.strength);
      setTimeout(() => {
        ignoreClick = false;
        renderNode(node);
      }, 0);
      return;
    }
    if (!moved) {
      if (!canceled) {
        input.focus({ preventScroll: true });
        input.select();
      }
      setTimeout(() => { ignoreClick = false; }, 0);
      return;
    }
    commit(node, { presetDirty: true, render: false });
    if (autoQueue) notifyEditorAutoQueue(node);
    setTimeout(() => {
      ignoreClick = false;
      renderNode(node);
    }, 0);
  };
  input.addEventListener("pointerup", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("click", (event) => {
    if (!ignoreClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
}


function setStrengthFill(input, value) {
  const fill = strengthFillParts(value);
  input.classList.toggle("negative", fill.negative);
  input.classList.toggle("layered", fill.blocks > 0);
  input.style.setProperty("--apex-strength-fill", `${fill.fraction}%`);
  input.style.setProperty("--apex-strength-block-fill", `${fill.blocks * 10}%`);
}


function createStrengthInput(node, row, className = "", autoQueue = false) {
  const input = document.createElement("input");
  input.className = `apex-strength${className ? ` ${className}` : ""}`;
  input.type = "text";
  input.inputMode = "decimal";
  input.maxLength = 7;
  input.value = formatStrength(row.strength);
  setStrengthFill(input, row.strength);
  input.title = `Model strength. Drag left or right to adjust by exactly ${node.__apexState.settings.strength_drag_step} per tick; click to type.`;
  input.setAttribute("aria-label", `Model strength for ${row.name}`);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  });
  input.addEventListener("change", () => {
    if (input.classList.contains("scrubbing")) return;
    const value = parseStrengthInput(input.value);
    if (value === null) {
      input.value = formatStrength(row.strength);
      setStrengthFill(input, row.strength);
      return;
    }
    row.strength = value;
    input.value = formatStrength(row.strength);
    setStrengthFill(input, row.strength);
    commit(node, { presetDirty: true });
    if (autoQueue) notifyEditorAutoQueue(node);
  });
  installStrengthDrag(node, row, input, autoQueue);
  return input;
}


function clearDragFeedback() {
  document.querySelectorAll(".apex-drop-marker").forEach((element) => element.remove());
  document.querySelectorAll(".apex-row-drag-over, .apex-section-drag-over").forEach((element) => {
    element.classList.remove("apex-row-drag-over", "apex-section-drag-over");
  });
  document.querySelectorAll(".apex-column-add-zone.intent").forEach((element) => {
    element.classList.remove("intent");
  });
}


function directChildren(container, className) {
  return [...container.children].filter((element) => element.classList.contains(className));
}


function showDropMarker(container, className, elements, index, marker = null) {
  if (!marker) {
    marker = document.createElement("div");
    marker.className = `${className} apex-drop-marker`;
  }
  container.insertBefore(marker, elements[index] || null);
}


function rowDropIndex(rows, clientY) {
  const marker = directChildren(rows, "apex-row-drop-marker")[0] || null;
  marker?.remove();
  const elements = directChildren(rows, "apex-row");
  const midpoints = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  return { elements, index: insertionIndexFromMidpoints(clientY, midpoints), marker };
}


function installRowDropTarget(node, section, rows) {
  rows.addEventListener("dragover", (event) => {
    if (dragPayload?.type !== "row" || dragPayload.node !== node) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    rows.classList.add("apex-row-drag-over");
    const target = rowDropIndex(rows, event.clientY);
    showDropMarker(rows, "apex-row-drop-marker", target.elements, target.index, target.marker);
  });
  rows.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && rows.contains(event.relatedTarget)) return;
    rows.classList.remove("apex-row-drag-over");
    directChildren(rows, "apex-row-drop-marker").forEach((element) => element.remove());
  });
  rows.addEventListener("drop", (event) => {
    if (dragPayload?.type !== "row" || dragPayload.node !== node) return;
    event.preventDefault();
    event.stopPropagation();
    const target = rowDropIndex(rows, event.clientY);
    moveRowWithSectionSync(node, dragPayload.rowId, section.id, target.index);
    dragPayload = null;
    clearDragFeedback();
    commit(node, { fullPresetDirty: true, folderSyncDirty: true });
  });
}


function buildRow(node, section, row) {
  const element = document.createElement("div");
  const showTriggerButton = node.__apexState.settings.show_trigger_button;
  element.className = `apex-row${showTriggerButton ? " with-trigger" : ""}${row.enabled ? "" : " disabled"}${row.error ? " error" : ""}`;
  element.title = row.error || row.name;
  const handle = document.createElement("span");
  handle.className = "apex-drag apex-row-drag";
  handle.textContent = "⠿";
  handle.title = "Drag to reorder or move to another section";
  handle.draggable = true;
  handle.addEventListener("dragstart", (event) => {
    clearDragFeedback();
    dragPayload = { type: "row", node, rowId: row.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.id);
  });
  handle.addEventListener("dragend", () => {
    dragPayload = null;
    clearDragFeedback();
  });

  const enabledCell = document.createElement("label");
  enabledCell.className = "apex-row-enable";
  enabledCell.title = "Enable or disable this LoRA";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = row.enabled;
  enabled.setAttribute("aria-label", `Enable ${row.name}`);
  enabled.title = "Enable or disable this LoRA";
  enabled.addEventListener("change", () => {
    row.enabled = enabled.checked;
    commit(node, { presetDirty: true });
    notifyEditorAutoQueue(node);
  });
  enabledCell.appendChild(enabled);

  const name = document.createElement("button");
  name.type = "button";
  name.className = "apex-lora-name";
  if (row.error) {
    const stateIcon = svgIcon("triangleAlert");
    stateIcon.classList.add("apex-row-state-icon");
    name.appendChild(stateIcon);
  }
  name.appendChild(loraNameContent(row.name, node.__apexState.settings));
  name.addEventListener("click", () => showLoraChooser(node, name, section.id, row.id));

  const strength = createStrengthInput(node, row, "", true);

  const triggerMetadata = normalizeTriggerMetadata(row);
  const triggerCount = triggerMetadata.trigger_words.length;
  const activeTriggerCount = triggerMetadata.active_trigger_words.length;
  const triggerPosition = normalizeTriggerPosition(row.trigger_position);
  const triggerState = !triggerCount
    ? "empty"
    : activeTriggerCount > 0
      ? "active"
      : "saved-inactive";
  const trigger = showTriggerButton
    ? iconButton(
        "tag",
        triggerState === "empty"
          ? "Add trigger words"
          : triggerState === "saved-inactive"
            ? `${triggerCount} trigger word${triggerCount === 1 ? " is" : "s are"} saved, but currently inactive`
            : `${triggerPosition === "prepend" ? "Prepend" : "Append"} ${activeTriggerCount} of ${triggerCount} trigger words: ${triggerMetadata.active_trigger_words.join(", ")}`,
      )
    : null;
  if (trigger) {
    trigger.classList.add("apex-trigger-button", triggerState);
    trigger.dataset.triggerState = triggerState;
    trigger.addEventListener("click", () => showTriggerEditor(node, trigger, row.id));
  }

  const remove = iconButton("x", "Remove this LoRA", "apex-row-remove");
  remove.addEventListener("click", () => {
    recordSectionSyncRemoval(section, row);
    section.loras.splice(section.loras.indexOf(row), 1);
    commit(node, { presetDirty: true, folderSyncDirty: true });
  });

  element.append(handle, enabledCell, name, strength);
  if (trigger) element.appendChild(trigger);
  element.appendChild(remove);
  return element;
}


function buildSection(node, section) {
  const enabledCount = section.loras.filter((row) => row.enabled).length;
  const element = document.createElement("div");
  element.className = `apex-section${section.collapsed ? " collapsed" : ""}`;
  element.dataset.sectionId = section.id;
  const header = document.createElement("div");
  header.className = "apex-section-header";
  const leading = document.createElement("div");
  leading.className = "apex-section-leading";
  const handle = document.createElement("span");
  handle.className = "apex-drag apex-section-drag";
  handle.textContent = "⠿";
  handle.title = "Drag to move this section within or between columns";
  handle.draggable = true;
  handle.addEventListener("dragstart", (event) => {
    clearDragFeedback();
    dragPayload = { type: "section", node, sectionId: section.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", section.id);
  });
  handle.addEventListener("dragend", () => {
    dragPayload = null;
    clearDragFeedback();
  });

  const toggleIcons = SECTION_TOGGLE_ICON_SETS[SECTION_TOGGLE_ICON_STYLE];
  const collapse = iconButton(
    section.collapsed ? toggleIcons.collapsed : toggleIcons.expanded,
    section.collapsed ? "Expand section" : "Collapse section",
    "apex-section-collapse",
  );
  collapse.addEventListener("click", () => {
    section.collapsed = !section.collapsed;
    commit(node, { fullPresetDirty: true });
  });
  const allEnabled = section.loras.length > 0 && enabledCount === section.loras.length;
  const anyEnabled = enabledCount > 0;
  const toggleAll = iconButton(
    "listTodo",
    anyEnabled ? "Disable all LoRAs in this section" : "Enable all LoRAs in this section",
    "apex-section-toggle-all",
  );
  toggleAll.disabled = section.loras.length === 0;
  toggleAll.classList.toggle("active", anyEnabled);
  toggleAll.setAttribute("aria-pressed", allEnabled ? "true" : anyEnabled ? "mixed" : "false");
  toggleAll.addEventListener("click", () => {
    toggleSectionRows(section);
    commit(node, { presetDirty: true });
    notifyEditorAutoQueue(node);
  });
  const name = document.createElement("input");
  name.className = "apex-section-name";
  name.value = section.name;
  name.maxLength = 100;
  name.title = "Section name";
  name.addEventListener("change", () => {
    const currentIndex = node.__apexState.sections.indexOf(section);
    section.name = name.value.trim() || `Section ${currentIndex + 1}`;
    commit(node, { fullPresetDirty: true });
  });
  const count = document.createElement("span");
  count.className = "apex-section-count";
  count.classList.toggle("active", enabledCount > 0);
  count.textContent = `${enabledCount}/${section.loras.length}`;
  count.title = "Enabled / total LoRAs";
  const title = document.createElement("div");
  title.className = "apex-section-title";
  title.append(name, count);
  const actions = document.createElement("div");
  actions.className = "apex-section-actions";
  const syncStatus = sectionSyncStatus(node, section.id);
  const autoSyncAdded = node.__apexFolderAutoSyncAdded?.get(section.id) || 0;
  const syncNotices = [
    autoSyncAdded
      ? `Auto Sync added ${autoSyncAdded} disabled LoRA${autoSyncAdded === 1 ? "" : "s"}`
      : "",
    syncStatus.actionable.length
      ? `${syncStatus.actionable.length} ${syncStatus.config.mode === "new" ? "new" : "missing"} LoRA${syncStatus.actionable.length === 1 ? "" : "s"} detected`
      : "",
  ].filter(Boolean);
  const addTitle = syncNotices.length
    ? `${syncNotices.join("; ")}; open Add LoRA to review`
    : syncStatus.config.enabled
      ? `Add a LoRA to this section; folder sync is ${syncStatus.config.mode === "new" ? "watching for new files" : "up to date"}`
      : "Add a LoRA to this section";
  const add = iconButton("plus", addTitle, "apex-section-add");
  if (syncStatus.actionable.length) {
    add.classList.add("sync-pending");
    const badge = document.createElement("span");
    badge.className = "apex-section-sync-badge";
    badge.textContent = syncStatus.actionable.length > 99
      ? "99+"
      : String(syncStatus.actionable.length);
    add.appendChild(badge);
  } else if (autoSyncAdded) {
    add.classList.add("sync-added");
    const badge = document.createElement("span");
    badge.className = "apex-section-sync-badge added";
    badge.textContent = autoSyncAdded > 99 ? "+99" : `+${autoSyncAdded}`;
    add.appendChild(badge);
  }
  add.addEventListener("click", () => {
    if (autoSyncAdded) {
      node.__apexFolderAutoSyncAdded?.delete(section.id);
      add.classList.remove("sync-added");
      add.querySelector(".apex-section-sync-badge.added")?.remove();
    }
    showLoraChooser(node, add, section.id);
  });
  const remove = iconButton("listX", "Delete this section", "apex-section-remove");
  remove.addEventListener("click", () => {
    if (section.loras.length && !window.confirm(`Delete “${section.name}” and its ${section.loras.length} LoRA row(s)?`)) return;
    node.__apexState.sections.splice(node.__apexState.sections.indexOf(section), 1);
    node.__apexFolderAutoSyncAdded?.delete(section.id);
    if (!node.__apexState.sections.length) node.__apexState.sections.push(createSection("LoRAs", 0));
    commit(node, { presetDirty: true, folderSyncDirty: true });
  });
  leading.append(handle, collapse, toggleAll);
  actions.append(remove, add);
  header.append(leading, title, actions);
  element.appendChild(header);

  element.addEventListener("dragover", (event) => {
    if (dragPayload?.type !== "row" || dragPayload.node !== node || event.target.closest(".apex-rows")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("apex-row-drag-over");
  });
  element.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && element.contains(event.relatedTarget)) return;
    element.classList.remove("apex-row-drag-over");
  });
  element.addEventListener("drop", (event) => {
    if (dragPayload?.type !== "row" || dragPayload.node !== node || event.target.closest(".apex-rows")) return;
    event.preventDefault();
    event.stopPropagation();
    moveRowWithSectionSync(
      node,
      dragPayload.rowId,
      section.id,
      section.loras.length,
    );
    if (section.collapsed) section.collapsed = false;
    dragPayload = null;
    clearDragFeedback();
    commit(node, { fullPresetDirty: true, folderSyncDirty: true });
  });

  if (!section.collapsed) {
    const rows = document.createElement("div");
    rows.className = `apex-rows${section.loras.length ? "" : " empty"}`;
    section.loras.forEach((row) => rows.appendChild(buildRow(node, section, row)));
    installRowDropTarget(node, section, rows);
    element.appendChild(rows);
  }
  return element;
}


function sectionDropTarget(node, lane, clientY) {
  const marker = directChildren(lane, "apex-section-drop-marker")[0] || null;
  marker?.remove();
  const elements = directChildren(lane, "apex-section");
  const midpoints = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const markerIndex = insertionIndexFromMidpoints(clientY, midpoints);
  if (!elements.length) {
    return {
      elements,
      markerIndex,
      marker,
      column: Number(lane.dataset.column) || 0,
      targetIndex: 0,
    };
  }

  const afterLast = markerIndex === elements.length;
  const reference = elements[afterLast ? elements.length - 1 : markerIndex];
  const target = node.__apexState.sections.find((section) => section.id === reference.dataset.sectionId);
  if (!target) {
    return {
      elements,
      markerIndex,
      marker,
      column: Number(lane.dataset.column) || 0,
      targetIndex: 0,
    };
  }
  const column = sectionColumn(target);
  const targetIndex = node.__apexState.sections
    .filter((section) => sectionColumn(section) === column)
    .findIndex((section) => section.id === target.id) + (afterLast ? 1 : 0);
  return { elements, markerIndex, marker, column, targetIndex };
}


function addSectionToColumn(node, column) {
  const section = createSection(`Section ${node.__apexState.sections.length + 1}`, column);
  addSectionToState(node.__apexState, section, column);
  commit(node, { fullPresetDirty: true, folderSyncDirty: true });
}


function createColumnAddZone(node, column) {
  const zone = document.createElement("div");
  zone.className = "apex-column-add-zone";
  zone.dataset.column = String(column);
  const add = iconButton(
    "listPlus",
    `Add a new section to column ${column + 1}`,
    "apex-column-add-button",
    "Add section",
  );

  const hide = () => {
    zone.classList.remove("intent");
  };
  const show = (event) => {
    if (dragPayload || event.buttons !== 0) return;
    zone.classList.add("intent");
  };

  zone.addEventListener("pointerenter", show);
  zone.addEventListener("pointerleave", hide);
  zone.addEventListener("pointercancel", hide);
  add.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!zone.classList.contains("intent")) return;
    hide();
    addSectionToColumn(node, column);
  });
  zone.appendChild(add);
  return zone;
}


function createSectionLane(node, column) {
  const lane = document.createElement("div");
  lane.className = "apex-section-column";
  lane.dataset.column = String(column);
  lane.addEventListener("dragover", (event) => {
    if (dragPayload?.type !== "section" || dragPayload.node !== node) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    lane.classList.add("apex-section-drag-over");
    const target = sectionDropTarget(node, lane, event.clientY);
    showDropMarker(
      lane,
      "apex-section-drop-marker",
      target.elements,
      target.markerIndex,
      target.marker,
    );
  });
  lane.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && lane.contains(event.relatedTarget)) return;
    lane.classList.remove("apex-section-drag-over");
    directChildren(lane, "apex-section-drop-marker").forEach((element) => element.remove());
  });
  lane.addEventListener("drop", (event) => {
    if (dragPayload?.type !== "section" || dragPayload.node !== node) return;
    event.preventDefault();
    const target = sectionDropTarget(node, lane, event.clientY);
    moveSection(
      node.__apexState,
      dragPayload.sectionId,
      target.column,
      target.targetIndex,
    );
    dragPayload = null;
    clearDragFeedback();
    commit(node, { fullPresetDirty: true });
  });
  return lane;
}


function layoutSections(node) {
  const view = editorView;
  if (!view || view.node !== node) return;
  const { stack, content, root } = view;
  if (!stack?.isConnected || !content?.isConnected) return;
  const sectionElements = [...content.querySelectorAll(".apex-section")];
  if (!sectionElements.length) return;

  const styles = getComputedStyle(root);
  const minimum = parseFloat(styles.getPropertyValue("--apex-section-min-width")) || 320;
  const maximum = parseFloat(styles.getPropertyValue("--apex-section-max-width")) || 646;
  const gap = parseFloat(styles.getPropertyValue("--apex-section-grid-gap")) || 6;
  const width = content.clientWidth || Math.max(1, (node.size?.[0] || DEFAULT_SIZE[0]) - 12);
  const columnCount = responsiveColumnCount(width, node.__apexState.sections.length, minimum, gap);
  const columnWidth = Math.min(maximum, (width - gap * (columnCount - 1)) / columnCount);
  const assigned = assignSectionColumns(node.__apexState, columnCount);
  if (assigned) commit(node, { presetDirty: false, render: false });

  const needsColumns = content.dataset.columns !== String(columnCount)
    || directChildren(content, "apex-section-column").length !== columnCount;
  if (needsColumns) {
    const elements = new Map(sectionElements.map((element) => [element.dataset.sectionId, element]));
    const lanes = Array.from({ length: columnCount }, (_, column) => createSectionLane(node, column));
    sectionsByVisibleColumn(node.__apexState, columnCount).forEach((sections, column) => {
      for (const section of sections) {
        const element = elements.get(section.id);
        if (element) lanes[column].appendChild(element);
      }
    });
    lanes.forEach((lane, column) => lane.appendChild(createColumnAddZone(node, column)));
    content.replaceChildren(...lanes);
  }

  content.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, ${columnWidth}px))`;
  content.dataset.columns = String(columnCount);
  node.__apexColumnCount = columnCount;
  if (Number.isFinite(view.pendingScrollTop)) {
    stack.scrollTop = view.pendingScrollTop;
    view.pendingScrollTop = null;
  }
}


function scheduleSectionLayout(node) {
  const view = editorView;
  if (!view || view.node !== node || view.layoutFrame != null) return;
  view.layoutFrame = requestAnimationFrame(() => {
    if (editorView !== view) return;
    view.layoutFrame = null;
    layoutSections(node);
  });
}


function suspendNodeUI(node) {
  if (node.__apexUiSuspended || !node.__apexRoot) return;
  closeTriggerPreview();
  node.__apexUiSuspended = true;
  node.__apexRoot.replaceChildren();
  node.__apexStatusElement = null;
  node.__apexOpenButton = null;
}


function resumeNodeUI(node) {
  if (!node.__apexUiSuspended || !node.__apexBuilt) return;
  node.__apexUiSuspended = false;
  renderNode(node);
}


function installNodeCollapseLifecycle(node) {
  if (node.__apexCollapseLifecycleInstalled || typeof node.collapse !== "function") return;
  node.__apexCollapseLifecycleInstalled = true;
  const collapse = node.collapse;
  node.collapse = function () {
    const result = collapse.apply(this, arguments);
    if (this.collapsed) suspendNodeUI(this);
    else resumeNodeUI(this);
    return result;
  };
}


function installWidgetVisibilityLifecycle(node, domWidget) {
  if (typeof domWidget?.isVisible !== "function") return;
  const isVisible = domWidget.isVisible.bind(domWidget);
  let wasVisible = isVisible();
  domWidget.isVisible = () => {
    const visible = isVisible();
    if (visible !== wasVisible) {
      wasVisible = visible;
      if (visible) resumeNodeUI(node);
      else suspendNodeUI(node);
    }
    return visible;
  };
}


function renderPreview(node, summary = previewSummary(node.__apexState)) {
  const root = node.__apexRoot;
  if (!root || !node.__apexState || node.__apexUiSuspended) return;
  if (openTriggerPreview?.anchor && root.contains(openTriggerPreview.anchor)) {
    closeTriggerPreview();
  }
  root.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "apex-preview-toolbar";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "apex-preview-open";
  open.title = "Open the full Apex LoRA editor";
  open.setAttribute("aria-label", "Open the full Apex LoRA editor");
  open.appendChild(svgIcon("externalLink"));
  open.addEventListener("click", () => editorController.open(node));
  node.__apexOpenButton = open;

  const metrics = document.createElement("div");
  metrics.className = `apex-preview-summary${summary.enabledRows ? " active" : ""}`;
  metrics.title = [
    `${summary.sectionCount} section${summary.sectionCount === 1 ? "" : "s"}`,
    `${summary.enabledRows} enabled LoRA${summary.enabledRows === 1 ? "" : "s"}`,
    `${summary.totalRows} total LoRA${summary.totalRows === 1 ? "" : "s"}`,
  ].join(", ");
  const appendMetric = (value, label, className = "") => {
    if (metrics.childElementCount) {
      const separator = document.createElement("span");
      separator.className = "apex-preview-summary-separator";
      separator.setAttribute("aria-hidden", "true");
      metrics.appendChild(separator);
    }
    const metric = document.createElement("span");
    metric.className = `apex-preview-summary-item${className ? ` ${className}` : ""}`;
    const number = document.createElement("strong");
    number.textContent = String(value);
    const text = document.createElement("span");
    text.textContent = label;
    metric.append(number, text);
    metrics.appendChild(metric);
  };
  appendMetric(summary.sectionCount, summary.sectionCount === 1 ? "section" : "sections");
  appendMetric(summary.enabledRows, "enabled", "enabled");
  appendMetric(summary.totalRows, "LoRAs");
  if (summary.errorRows) {
    appendMetric(summary.errorRows, summary.errorRows === 1 ? "issue" : "issues", "error");
  }
  toolbar.append(metrics, open);
  root.appendChild(toolbar);

  const list = document.createElement("div");
  list.className = "apex-preview-list";
  if (!summary.rows.length) {
    const empty = document.createElement("div");
    empty.className = "apex-preview-empty";
    empty.textContent = summary.totalRows
      ? "No LoRAs enabled"
      : "Open the editor to build your LoRA stack";
    list.appendChild(empty);
  } else {
    for (const item of summary.rows) {
      const row = document.createElement("div");
      row.className = `apex-preview-row${item.effective ? "" : " inactive"}${item.error ? " error" : ""}`;
      row.setAttribute("aria-label", item.error || `${item.sectionName} / ${item.name}`);
      const main = document.createElement("div");
      main.className = "apex-preview-row-main";
      const section = document.createElement("span");
      section.className = "apex-preview-section";
      section.textContent = item.sectionName;
      section.title = item.sectionName;
      const name = document.createElement("span");
      name.className = "apex-preview-name";
      name.textContent = previewDisplayName(item.name, node.__apexState.settings);
      name.title = item.error || `${item.sectionName} / ${item.name}`;
      main.append(section, name);
      const sourceRow = rowById(node, item.id);
      if (item.triggerWordCount && sourceRow) {
        const trigger = document.createElement("span");
        trigger.classList.add(
          "apex-preview-trigger",
          item.activeTriggerWordCount ? "active" : "saved-inactive",
        );
        trigger.tabIndex = 0;
        trigger.appendChild(svgIcon("tag"));
        const triggerNoun = item.triggerWordCount === 1 ? "trigger word" : "trigger words";
        trigger.setAttribute("aria-label", item.activeTriggerWordCount
          ? `${item.activeTriggerWordCount} active of ${item.triggerWordCount} saved ${triggerNoun}`
          : `${item.triggerWordCount} saved ${triggerNoun}; none active`);
        attachTriggerPreview(trigger, node, sourceRow);
        main.appendChild(trigger);
      }
      const strength = sourceRow
        ? createStrengthInput(node, sourceRow, "apex-preview-strength")
        : document.createElement("span");
      if (!sourceRow) {
        strength.className = "apex-preview-strength";
        strength.textContent = formatStrength(item.strength);
      }
      row.append(main, strength);
      list.appendChild(row);
    }
    if (summary.overflow) {
      const more = document.createElement("div");
      more.className = "apex-preview-more";
      more.textContent = `+${summary.overflow} more enabled`;
      list.appendChild(more);
    }
  }
  root.appendChild(list);

  const status = document.createElement("div");
  status.className = `apex-preview-status${node.__apexStatus?.error ? " error" : ""}`;
  status.textContent = node.__apexStatus?.message || "";
  status.title = status.textContent;
  node.__apexStatusElement = status;
  root.appendChild(status);
}


function renderEditor(node) {
  const view = editorView;
  if (!view || view.node !== node || !view.root?.isConnected || !node.__apexState) return;
  const settings = normalizeSettings(node.__apexState.settings);
  if (view.autoQueue && view.autoQueue.state.enabled !== settings.run_on_change_enabled) {
    view.autoQueue.setEnabled(settings.run_on_change_enabled);
  }
  syncEditorStage(node);
  view.pendingScrollTop = view.stack?.scrollTop ?? view.pendingScrollTop ?? 0;
  view.controls.replaceChildren(buildToolbar(node));
  const root = view.root;
  root.replaceChildren();
  const stack = document.createElement("div");
  stack.className = "apex-stack";
  const content = document.createElement("div");
  content.className = "apex-stack-content";
  node.__apexState.sections.forEach((section) => {
    content.appendChild(buildSection(node, section));
  });
  stack.appendChild(content);
  root.appendChild(stack);
  view.stack = stack;
  view.content = content;
  scheduleSectionLayout(node);
}


function renderNode(node) {
  if (!node.__apexState) return;
  const summary = previewSummary(node.__apexState);
  renderPreview(node, summary);
  if (editorController.isOpenFor(node)) renderEditor(node);
}


function syncEditorStage(node) {
  const view = editorView;
  if (!view || view.node !== node || !view.shell?.isConnected || !view.stage) return;
  const scale = normalizeSettings(node.__apexState.settings).overlay_scale;
  view.overlay.style.setProperty("--apex-editor-ui-scale", String(scale));
  const width = view.shell.clientWidth;
  const height = view.shell.clientHeight;
  if (width > 0 && height > 0) {
    view.stage.style.width = `${width / scale}px`;
    view.stage.style.height = `${height / scale}px`;
  }
  scheduleSectionLayout(node);
}


function closeNodeEditor(node) {
  const view = editorView;
  const activeElement = document.activeElement;
  if (
    view?.node === node
    && typeof activeElement?.blur === "function"
    && (
      view.overlay.contains(activeElement)
      || openPopover?.panel?.contains(activeElement)
    )
  ) {
    // Commit native change/blur handlers before their controls are detached.
    activeElement.blur();
  }
  return editorController.close(node);
}


function mountNodeEditor(node) {
  closeTriggerPreview();
  closeOpenPopover();
  const overlay = document.createElement("div");
  overlay.className = "apex-editor-overlay";
  overlay.style.setProperty(
    "--apex-editor-ui-scale",
    String(normalizeSettings(node.__apexState.settings).overlay_scale),
  );
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Apex LoRA Loader editor");

  const shell = document.createElement("div");
  shell.className = "apex-editor-shell";
  const header = document.createElement("div");
  header.className = "apex-editor-header";
  const controls = document.createElement("div");
  controls.className = "apex-editor-controls";
  const status = document.createElement("div");
  status.className = "apex-editor-status";
  status.dataset.idleLabel = "Ready";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const statusDot = document.createElement("span");
  statusDot.className = "apex-editor-status-dot";
  statusDot.setAttribute("aria-hidden", "true");
  const statusMessage = document.createElement("span");
  statusMessage.className = "apex-editor-status-message";
  status.__apexMessageElement = statusMessage;
  status.append(statusDot, statusMessage);
  updateStatusElement(
    status,
    node.__apexStatus?.message || "",
    node.__apexStatus?.error === true,
  );
  const autoQueueControl = document.createElement("button");
  autoQueueControl.type = "button";
  autoQueueControl.className = "apex-editor-auto-queue";
  autoQueueControl.setAttribute("aria-pressed", "false");
  const autoQueueLabel = document.createElement("span");
  autoQueueLabel.className = "apex-editor-auto-queue-label";
  autoQueueLabel.textContent = "Run on change";
  autoQueueControl.appendChild(autoQueueLabel);
  const run = document.createElement("button");
  run.type = "button";
  run.className = "apex-editor-run";
  run.title = "Queue the current workflow once";
  run.setAttribute("aria-label", "Run workflow");
  const runLabel = document.createElement("span");
  runLabel.textContent = "Run workflow";
  run.append(svgIcon("play"), runLabel);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "apex-editor-close";
  close.title = "Close editor";
  close.setAttribute("aria-label", "Close Apex LoRA editor");
  close.appendChild(svgIcon("x"));
  const runCluster = document.createElement("div");
  runCluster.className = "apex-editor-run-cluster";
  runCluster.append(run, autoQueueControl);
  header.append(controls, status, runCluster, close);

  const root = document.createElement("div");
  root.className = "apex-lora-root apex-editor-root";
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  const stage = document.createElement("div");
  stage.className = "apex-editor-stage";
  stage.append(header, root);
  shell.appendChild(stage);
  overlay.appendChild(shell);

  const previousFocus = document.activeElement;
  const keydown = (event) => {
    if (event.key !== "Escape" || openPopover) return;
    event.preventDefault();
    closeNodeEditor(node);
  };
  const overlayKeydown = (event) => {
    if (event.key === "Tab") {
      const focusable = [...overlay.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    // The fixed editor is modal. Let controls receive the event, then prevent
    // ComfyUI's graph-level keyboard shortcuts from acting underneath it.
    event.stopPropagation();
  };
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => syncEditorStage(node))
    : null;

  editorView = {
    node,
    overlay,
    shell,
    stage,
    root,
    controls,
    statusElement: status,
    autoQueue: null,
    autoQueueControl,
    runButton: run,
    manualQueueBusy: false,
    stack: null,
    content: null,
    pendingScrollTop: node.__apexEditorScrollTop ?? 0,
    layoutFrame: null,
    resizeObserver,
    keydown,
    previousFocus,
  };
  const view = editorView;
  view.autoQueue = createAutoQueueController({
    getDelayMs: () => normalizeSettings(node.__apexState.settings).run_on_change_delay_ms,
    getSignature: () => activeLoraSignature(node.__apexState),
    isBlocked: () => presetJobsSubmissionBusy || view.manualQueueBusy,
    submit: () => app.queuePrompt(0, 1),
    onState: (state) => handleAutoQueueState(node, state),
  });
  view.autoQueue.setEnabled(
    normalizeSettings(node.__apexState.settings).run_on_change_enabled,
  );
  autoQueueControl.addEventListener("click", () => {
    const enabled = view.autoQueue.setEnabled(!view.autoQueue.state.enabled);
    node.__apexState.settings = normalizeSettings({
      ...node.__apexState.settings,
      run_on_change_enabled: enabled,
    });
    commit(node, { fullPresetDirty: true, render: false });
    setStatus(node, enabled ? "Run on change enabled." : "Run on change disabled.");
  });
  run.addEventListener("click", async () => {
    if (run.disabled) return;
    run.setAttribute("aria-busy", "true");
    try {
      await queueWorkflowFromEditor(node);
    } finally {
      run.removeAttribute("aria-busy");
    }
  });
  close.addEventListener("click", () => closeNodeEditor(node));
  overlay.addEventListener("keydown", overlayKeydown);
  overlay.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeNodeEditor(node);
  });
  document.addEventListener("keydown", keydown, true);
  document.body.appendChild(overlay);
  document.body.classList.add("apex-editor-active");
  resizeObserver?.observe(shell);
  syncEditorStage(node);
  syncEditorQueueControls(node);
  setTimeout(() => close.focus({ preventScroll: true }), 0);
}


function unmountNodeEditor(node) {
  const view = editorView;
  if (!view || view.node !== node) return;
  node.__apexEditorScrollTop = view.stack?.scrollTop ?? view.pendingScrollTop ?? 0;
  if (view.layoutFrame != null) cancelAnimationFrame(view.layoutFrame);
  view.autoQueue?.dispose();
  view.resizeObserver?.disconnect();
  document.removeEventListener("keydown", view.keydown, true);
  if (dragPayload?.node === node) {
    dragPayload = null;
    clearDragFeedback();
  }
  closeOpenPopover();
  view.overlay.remove();
  document.body.classList.remove("apex-editor-active");
  editorView = null;
  if (!node.__apexRemoving) {
    const focusTarget = node.__apexOpenButton?.isConnected
      ? node.__apexOpenButton
      : view.previousFocus?.isConnected
        ? view.previousFocus
        : null;
    focusTarget?.focus?.({ preventScroll: true });
  }
}


function buildNodeUI(node) {
  if (node.__apexBuilt) return;
  node.__apexBuilt = true;
  if (node.color == null) node.color = NODE_TITLE_COLOR;
  if (node.bgcolor == null) node.bgcolor = NODE_BODY_COLOR;
  injectStyles();
  const widget = dataWidget(node);
  hideDataWidget(widget);
  node.__apexState = normalizeState(widget?.value);
  if (widget) widget.value = serializeState(node.__apexState);
  node.__apexPresets = presetsCache || [];
  node.__apexFolderSyncRevision = 0;
  node.__apexFolderSyncCache = null;
  node.__apexFolderSyncErrors = new Map();
  node.__apexFolderAutoSyncAdded = new Map();

  const root = document.createElement("div");
  root.className = "apex-lora-preview";
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  const domWidget = node.addDOMWidget("apex_lora_ui", "apex-lora-preview", root, {
    serialize: false,
    margin: 3,
    getMinHeight: () => PREVIEW_MIN_HEIGHT,
  });
  // ComfyUI's DOM widget implementation otherwise performs getComputedStyle(root)
  // during every expanded canvas redraw, even when getMinHeight is provided.
  domWidget.computeLayoutSize = () => ({
    minHeight: PREVIEW_MIN_HEIGHT,
    maxHeight: undefined,
    minWidth: 0,
  });
  domWidget.serializeValue = () => undefined;
  node.__apexRoot = root;
  node.__apexDomWidget = domWidget;
  node.__apexUiSuspended = false;
  installNodeCollapseLifecycle(node);
  installWidgetVisibilityLifecycle(node, domWidget);
  node.size = [
    Math.max(node.size?.[0] || 0, DEFAULT_SIZE[0]),
    Math.max(node.size?.[1] || 0, DEFAULT_SIZE[1]),
  ];
  renderNode(node);

  loadPresets().then((presets) => {
    if (!node.__apexBuilt) return;
    node.__apexPresets = presets;
    renderNode(node);
  }).catch((error) => setStatus(node, error.message, true));
  loadCatalog().then(() => {
    if (!node.__apexBuilt) return;
    invalidateSectionSync(node);
    refreshNodeSectionSyncStatus(node, true);
  }).catch((error) => setStatus(node, error.message, true));
  setTimeout(() => resolveNodeLoras(node, false), 0);
}


function handleRuntimeResolution(event) {
  const detail = event.detail || {};
  const node = app.graph?._nodes_by_id?.[detail.node_id] ||
    app.graph?._nodes?.find((item) => String(item.id) === String(detail.node_id));
  if (!node?.__apexState) return;
  let changed = 0;
  for (const update of detail.updates || []) {
    const row = rowById(node, update.row_id) ||
      allRows(node.__apexState).find((item) => item.name === update.old_name);
    if (!row) continue;
    const section = node.__apexState.sections.find((item) => item.loras.includes(row));
    const previous = rowIdentity(row);
    row.name = update.name;
    row.sha256 = update.sha256;
    row.size = update.size;
    delete row.error;
    if (section) {
      migrateSectionSyncIdentity(
        section,
        previous,
        rowIdentity(row),
      );
    }
    changed += 1;
  }
  if (changed) {
    commit(node, { presetDirty: false, folderSyncDirty: true });
    setStatus(node, `Updated ${changed} renamed LoRA${changed === 1 ? "" : "s"}.`);
  }
}


api.addEventListener("apex-lora-loader/resolved", handleRuntimeResolution);
window.addEventListener(PRESET_JOBS_SUBMISSION_EVENT, handlePresetJobsSubmissionState);

app.registerExtension({
  name: "apex.ApexLoraLoader",
  async refreshComboInNodes() {
    await refreshCatalogFromComfy();
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      buildNodeUI(this);
      return result;
    };
    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      if (!this.__apexBuilt) buildNodeUI(this);
      hideDataWidget(dataWidget(this));
      this.__apexState = normalizeState(dataWidget(this)?.value);
      this.__apexFolderAutoSyncAdded?.clear?.();
      invalidateSectionSync(this, true);
      const widget = dataWidget(this);
      if (widget) widget.value = serializeState(this.__apexState);
      if (this.collapsed) {
        suspendNodeUI(this);
        editorController.refresh(this);
      }
      else if (this.__apexUiSuspended) resumeNodeUI(this);
      else renderNode(this);
      setTimeout(() => resolveNodeLoras(this, false), 0);
      return result;
    };
    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.__apexRemoving = true;
      editorController.nodeRemoved(this);
      if (dragPayload?.node === this) dragPayload = null;
      clearDragFeedback();
      if (
        openTriggerPreview?.anchor
        && this.__apexRoot?.contains(openTriggerPreview.anchor)
      ) {
        closeTriggerPreview();
      }
      if (this.__apexStatusTimer != null) {
        clearTimeout(this.__apexStatusTimer);
        this.__apexStatusTimer = null;
      }
      this.__apexRoot?.replaceChildren();
      this.__apexStatusElement = null;
      this.__apexOpenButton = null;
      this.__apexFolderSyncCache = null;
      this.__apexFolderSyncErrors = null;
      this.__apexFolderAutoSyncAdded = null;
      this.__apexBuilt = false;
      try {
        return originalRemoved?.apply(this, arguments);
      } finally {
        this.__apexRemoving = false;
      }
    };
  },
});
