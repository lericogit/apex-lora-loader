import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  DEFAULT_SETTINGS,
  STRENGTH_DRAG_PIXELS_PER_TICK,
  addSection as addSectionToState,
  addTriggerWord,
  assignSectionColumns,
  allRows,
  applyPreset,
  createRow,
  createSection,
  insertionIndexFromMidpoints,
  matchesFolderFilters,
  moveRow,
  moveSection,
  normalizeSettings,
  normalizeStrength,
  normalizeState,
  normalizeTriggerMetadata,
  normalizeTriggerPosition,
  presetEntriesFromState,
  responsiveColumnCount,
  sectionColumn,
  sectionsByVisibleColumn,
  serializeState,
  removeTriggerWord,
  toggleTriggerWord,
  strengthFromDrag,
  toggleSectionRows,
} from "./state.js";

const NODE_CLASS = "ApexLoraLoader";
const DATA_WIDGET = "stack_data";
const DEFAULT_SIZE = [540, 380];
const NODE_TITLE_COLOR = "#181c23";
const NODE_BODY_COLOR = "#0f141a";
const SECTION_TOGGLE_ICON_STYLE = "chevrons";

const SECTION_TOGGLE_ICON_SETS = {
  chevrons: { collapsed: "chevronRight", expanded: "chevronDown" },
  listChevrons: { collapsed: "listChevronsUpDown", expanded: "listChevronsDownUp" },
};

let catalogCache = null;
let presetsCache = null;
let metadataCache = null;
let openPopover = null;
let dragPayload = null;

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
  fileSliders: {
    className: "lucide-file-sliders",
    nodes: [
      ["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
      ["path", { d: "M8 12h8" }],
      ["path", { d: "M10 11v2" }],
      ["path", { d: "M8 17h8" }],
      ["path", { d: "M14 16v2" }],
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


function injectStyles() {
  if (document.querySelector("link[data-apex-lora-styles]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./apex_lora_loader.css", import.meta.url).href;
  link.dataset.apexLoraStyles = "true";
  document.head.appendChild(link);
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


async function loadCatalog(force = false) {
  if (force || catalogCache === null) {
    catalogCache = await fetchJson("/apex_lora_loader/loras");
  }
  return catalogCache;
}


async function loadPresets(force = false) {
  if (force || presetsCache === null) {
    const data = await fetchJson("/apex_lora_loader/presets");
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


function hideDataWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.type = "apex_hidden";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
  if (widget.inputEl) widget.inputEl.style.display = "none";
  if (widget.element) widget.element.style.display = "none";
}


function setStatus(node, message = "", error = false) {
  node.__apexStatus = { message, error };
  if (node.__apexStatusElement) {
    node.__apexStatusElement.textContent = message;
    node.__apexStatusElement.classList.toggle("error", error);
    node.__apexStatusElement.title = message;
  }
}


function commit(node, { presetDirty = false, render = true } = {}) {
  if (presetDirty) node.__apexState.active_preset_id = null;
  const widget = dataWidget(node);
  if (widget) widget.value = serializeState(node.__apexState);
  node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
  if (render) renderNode(node);
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
  document.body.appendChild(panel);

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
    const catalog = await loadCatalog();
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
    controls.appendChild(search);
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
          let added = 0;
          for (const identity of identities) {
            if (currentNames.has(identity.name)) continue;
            currentTarget.loras.push(createRow(identity));
            currentNames.add(identity.name);
            added += 1;
          }
          currentTarget.collapsed = false;
          commit(node, { presetDirty: true });
          close();
          setStatus(node, `Added ${added} LoRA${added === 1 ? "" : "s"} to "${currentTarget.name}".`);
        } catch (error) {
          addAll.disabled = false;
          search.disabled = false;
          addAll.textContent = "Add all LoRAs";
          setStatus(node, error.message, true);
        }
      });
      controls.appendChild(addAll);
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
            if (rowId) {
              const row = rowById(node, rowId);
              if (!row) return;
              Object.assign(row, identity);
              applyTriggerMetadata(row, identity);
              delete row.error;
            } else {
              const section = sectionById(node, sectionId);
              if (!section) return;
              section.loras.push(createRow(identity));
              section.collapsed = false;
            }
            setStatus(node, "");
            commit(node, { presetDirty: true });
            close();
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
      commit(node, { presetDirty: false });
      close();
    });
    renderFolders();
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
  });
  apply.addEventListener("click", () => {
    const step = Number(dragStep.value);
    if (!Number.isFinite(step) || step < 0.01 || step > 100) {
      setStatus(node, "Strength drag step must be between 0.01 and 100.", true);
      dragStep.focus();
      return;
    }
    node.__apexState.settings = normalizeSettings({
      show_safetensors: showSafetensors.checked,
      show_folder_paths: showFolderPaths.checked,
      show_trigger_button: showTriggerButton.checked,
      strength_drag_step: step,
    });
    commit(node, { presetDirty: false });
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
    if (changed && node !== deferredNode) commit(node, { presetDirty: false });
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
    if (changed) commit(node, { presetDirty: false });
  }
}


async function showTriggerEditor(node, anchor, rowId) {
  try {
    let row = rowById(node, rowId);
    if (!row) return;
    if (!/^[0-9a-f]{64}$/i.test(row.sha256) || !Number.isInteger(row.size)) {
      setStatus(node, `Identifying ${splitName(row.name).file}…`);
      const [identity] = await identifyNames([row.name]);
      if (!identity) throw new Error("The selected LoRA could not be identified.");
      Object.assign(row, identity);
      applyTriggerMetadata(row, identity);
      commit(node, { presetDirty: false, render: false });
    }

    row = rowById(node, rowId);
    if (!row) return;
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
        commit(node, { presetDirty: false });
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
  if (!rows.length) {
    if (force) setStatus(node, "LoRA list refreshed.");
    return;
  }
  try {
    if (force) await loadCatalog(true);
    setStatus(node, force ? "Refreshing and verifying LoRAs…" : "Checking LoRA names…");
    const data = await fetchJson("/apex_lora_loader/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: rows.map(({ id, name, sha256, size, trigger_words, active_trigger_words }) => ({
          id,
          name,
          sha256,
          size,
          trigger_words,
          active_trigger_words,
        })),
        force,
      }),
    });
    if (data.entries?.length) metadataCache = null;
    let renamed = 0;
    let stateChanged = false;
    let contentChanged = false;
    for (const identity of data.entries || []) {
      const row = rowById(node, identity.id);
      if (!row) continue;
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
    }
    for (const item of data.errors || []) {
      const row = rowById(node, item.id);
      if (row) row.error = item.error;
    }
    if (stateChanged) commit(node, { presetDirty: contentChanged });
    else renderNode(node);
    const errors = data.errors?.length || 0;
    if (errors) setStatus(node, `${errors} LoRA${errors === 1 ? " is" : "s are"} missing.`, true);
    else if (renamed) setStatus(node, `Updated ${renamed} renamed LoRA${renamed === 1 ? "" : "s"}.`);
    else setStatus(node, force ? "LoRAs refreshed and verified." : "");
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


async function ensureEnabledIdentities(node) {
  const rows = allRows(node.__apexState).filter(
    (row) => row.enabled && (!/^[0-9a-f]{64}$/i.test(row.sha256) || !Number.isInteger(row.size)),
  );
  if (!rows.length) return;
  const identities = await identifyNames(rows.map((row) => row.name));
  identities.forEach((identity, index) => {
    Object.assign(rows[index], identity);
    applyTriggerMetadata(rows[index], identity);
  });
  commit(node, { presetDirty: false, render: false });
}


async function refreshPresetNodes(activeId = null) {
  presetsCache = null;
  const presets = await loadPresets(true);
  for (const node of app.graph?._nodes || []) {
    if ((node.comfyClass || node.type) !== NODE_CLASS || !node.__apexState) continue;
    node.__apexPresets = presets;
    if (activeId && node === app.canvas?.current_node) node.__apexState.active_preset_id = activeId;
    renderNode(node);
  }
  return presets;
}


async function savePreset(node) {
  try {
    await ensureEnabledIdentities(node);
    const current = node.__apexPresets?.find(
      (preset) => preset.id === node.__apexState.active_preset_id,
    );
    const name = window.prompt("Preset name", current?.name || "");
    if (name === null || !name.trim()) return;
    const existing = node.__apexPresets?.find(
      (preset) => preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    );
    if (existing && !window.confirm(`Overwrite preset “${existing.name}”?`)) return;
    const preset = {
      id: existing?.id || current?.id || crypto.randomUUID(),
      name: name.trim(),
      entries: presetEntriesFromState(node.__apexState),
    };
    const saved = await fetchJson("/apex_lora_loader/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preset),
    });
    node.__apexState.active_preset_id = saved.id;
    commit(node, { presetDirty: false });
    await refreshPresetNodes();
    node.__apexState.active_preset_id = saved.id;
    commit(node, { presetDirty: false });
    setStatus(node, `Saved preset “${saved.name}”.`);
  } catch (error) {
    setStatus(node, error.message, true);
  }
}


function showPresetManager(node, anchor) {
  const preset = node.__apexPresets?.find(
    (item) => item.id === node.__apexState.active_preset_id,
  );
  if (!preset) {
    setStatus(node, "Select a preset to rename or delete.", true);
    return;
  }
  const { panel, close } = createPopover(anchor, `Manage “${preset.name}”`, "apex-preset-manager");
  const actions = document.createElement("div");
  actions.className = "apex-popover-actions";
  const rename = document.createElement("button");
  rename.textContent = "Rename";
  rename.className = "apex-primary-action";
  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.className = "apex-danger-action";
  actions.append(rename, remove);
  panel.appendChild(actions);
  rename.addEventListener("click", async () => {
    const name = window.prompt("New preset name", preset.name);
    if (name === null || !name.trim() || name.trim() === preset.name) return;
    try {
      const updated = await fetchJson(`/apex_lora_loader/presets/${encodeURIComponent(preset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      await refreshPresetNodes();
      node.__apexState.active_preset_id = updated.id;
      commit(node, { presetDirty: false });
      setStatus(node, `Renamed preset to “${updated.name}”.`);
      close();
    } catch (error) {
      setStatus(node, error.message, true);
    }
  });
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete preset “${preset.name}”?`)) return;
    try {
      await fetchJson(`/apex_lora_loader/presets/${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
      });
      node.__apexState.active_preset_id = null;
      commit(node, { presetDirty: false });
      await refreshPresetNodes();
      setStatus(node, `Deleted preset “${preset.name}”.`);
      close();
    } catch (error) {
      setStatus(node, error.message, true);
    }
  });
}


function applySelectedPreset(node, presetId) {
  const preset = node.__apexPresets?.find((item) => item.id === presetId);
  if (!preset) {
    node.__apexState.active_preset_id = null;
    commit(node, { presetDirty: false });
    return;
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
}


function buildToolbar(node) {
  const toolbar = document.createElement("div");
  toolbar.className = "apex-toolbar";
  const presets = document.createElement("select");
  presets.title = "Apply a global state preset";
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom";
  presets.appendChild(custom);
  for (const preset of node.__apexPresets || []) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    presets.appendChild(option);
  }
  presets.value = node.__apexPresets?.some(
    (preset) => preset.id === node.__apexState.active_preset_id,
  ) ? node.__apexState.active_preset_id : "";
  presets.addEventListener("change", () => applySelectedPreset(node, presets.value));

  const save = iconButton(
    "savePlus",
    "Save the current enabled LoRAs and strengths as a global preset",
    "apex-tool",
  );
  save.addEventListener("click", () => savePreset(node));
  const manage = iconButton("fileSliders", "Rename or delete the selected preset", "apex-tool");
  manage.addEventListener("click", () => showPresetManager(node, manage));
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
  presetTools.append(presets, save, manage);
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


function installStrengthDrag(node, row, input) {
  let drag = null;
  let ignoreClick = false;

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const value = Number(input.value);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: Number.isFinite(value) ? value : row.strength,
      ticks: 0,
      moved: false,
    };
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
    input.value = String(row.strength);
    setStrengthFill(input, row.strength);
  });

  const finish = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    input.classList.remove("dragging");
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    if (!moved) return;
    event.preventDefault();
    ignoreClick = true;
    commit(node, { presetDirty: true, render: false });
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
  const strength = Number(value);
  const fill = Number.isFinite(strength) ? Math.min(100, Math.abs(strength) * 100) : 0;
  input.classList.toggle("negative", strength < 0);
  input.style.setProperty("--apex-strength-fill", `${fill}%`);
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
    moveRow(node.__apexState, dragPayload.rowId, section.id, target.index);
    dragPayload = null;
    clearDragFeedback();
    commit(node, { presetDirty: false });
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

  const strength = document.createElement("input");
  strength.className = "apex-strength";
  strength.type = "number";
  strength.min = "-100";
  strength.max = "100";
  strength.step = "0.01";
  strength.value = String(row.strength);
  setStrengthFill(strength, row.strength);
  strength.title = `Model strength. Drag left or right to adjust by exactly ${node.__apexState.settings.strength_drag_step} per tick; click to type.`;
  strength.addEventListener("change", () => {
    const value = Number(strength.value);
    if (!Number.isFinite(value)) {
      strength.value = String(row.strength);
      setStrengthFill(strength, row.strength);
      return;
    }
    row.strength = normalizeStrength(value);
    strength.value = String(row.strength);
    setStrengthFill(strength, row.strength);
    commit(node, { presetDirty: true });
  });
  installStrengthDrag(node, row, strength);

  const triggerMetadata = normalizeTriggerMetadata(row);
  const triggerCount = triggerMetadata.trigger_words.length;
  const activeTriggerCount = triggerMetadata.active_trigger_words.length;
  const triggerPosition = normalizeTriggerPosition(row.trigger_position);
  const trigger = showTriggerButton
    ? iconButton(
        "tag",
        triggerCount
          ? `${triggerPosition === "prepend" ? "Prepend" : "Append"} ${activeTriggerCount} of ${triggerCount} trigger words: ${triggerMetadata.active_trigger_words.join(", ") || "none active"}`
          : "Add trigger words",
      )
    : null;
  if (trigger) {
    trigger.classList.add("apex-trigger-button");
    trigger.classList.toggle("active", activeTriggerCount > 0);
    trigger.addEventListener("click", () => showTriggerEditor(node, trigger, row.id));
  }

  const remove = iconButton("trash", "Remove this LoRA", "apex-row-remove");
  remove.addEventListener("click", () => {
    section.loras.splice(section.loras.indexOf(row), 1);
    commit(node, { presetDirty: true });
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
    commit(node, { presetDirty: false });
  });
  const allEnabled = section.loras.length > 0 && enabledCount === section.loras.length;
  const toggleAll = iconButton(
    "listTodo",
    allEnabled ? "Disable all LoRAs in this section" : "Enable all LoRAs in this section",
    "apex-section-toggle-all",
  );
  toggleAll.disabled = section.loras.length === 0;
  toggleAll.classList.toggle("active", allEnabled);
  toggleAll.setAttribute("aria-pressed", String(allEnabled));
  toggleAll.addEventListener("click", () => {
    toggleSectionRows(section);
    commit(node, { presetDirty: true });
  });
  const name = document.createElement("input");
  name.className = "apex-section-name";
  name.value = section.name;
  name.maxLength = 100;
  name.title = "Section name";
  name.addEventListener("change", () => {
    const currentIndex = node.__apexState.sections.indexOf(section);
    section.name = name.value.trim() || `Section ${currentIndex + 1}`;
    commit(node, { presetDirty: false });
  });
  const count = document.createElement("span");
  count.className = "apex-section-count";
  count.textContent = `${enabledCount}/${section.loras.length}`;
  count.title = "Enabled / total LoRAs";
  const title = document.createElement("div");
  title.className = "apex-section-title";
  title.append(name, count);
  const actions = document.createElement("div");
  actions.className = "apex-section-actions";
  const add = iconButton("plus", "Add a LoRA to this section", "apex-section-add");
  add.addEventListener("click", () => showLoraChooser(node, add, section.id));
  const remove = iconButton("listX", "Delete this section", "apex-section-remove");
  remove.addEventListener("click", () => {
    if (section.loras.length && !window.confirm(`Delete “${section.name}” and its ${section.loras.length} LoRA row(s)?`)) return;
    node.__apexState.sections.splice(node.__apexState.sections.indexOf(section), 1);
    if (!node.__apexState.sections.length) node.__apexState.sections.push(createSection("LoRAs", 0));
    commit(node, { presetDirty: true });
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
    moveRow(node.__apexState, dragPayload.rowId, section.id, section.loras.length);
    if (section.collapsed) section.collapsed = false;
    dragPayload = null;
    clearDragFeedback();
    commit(node, { presetDirty: false });
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
  commit(node, { presetDirty: false });
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
    commit(node, { presetDirty: false });
  });
  return lane;
}


function layoutSections(node) {
  const stack = node.__apexStack;
  const content = node.__apexStackContent;
  if (!stack?.isConnected || !content?.isConnected) return;
  const sectionElements = [...content.querySelectorAll(".apex-section")];
  if (!sectionElements.length) return;

  const styles = getComputedStyle(node.__apexRoot);
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
  if (Number.isFinite(node.__apexPendingScrollTop)) {
    stack.scrollTop = node.__apexPendingScrollTop;
    node.__apexPendingScrollTop = null;
  }
}


function scheduleSectionLayout(node) {
  if (node.__apexLayoutFrame != null) return;
  node.__apexLayoutFrame = requestAnimationFrame(() => {
    node.__apexLayoutFrame = null;
    layoutSections(node);
  });
}


function renderNode(node) {
  const root = node.__apexRoot;
  if (!root || !node.__apexState) return;
  node.__apexPendingScrollTop = node.__apexStack?.scrollTop || 0;
  root.replaceChildren();
  root.appendChild(buildToolbar(node));
  const status = document.createElement("div");
  status.className = `apex-status${node.__apexStatus?.error ? " error" : ""}`;
  status.textContent = node.__apexStatus?.message || "";
  status.title = status.textContent;
  node.__apexStatusElement = status;
  root.appendChild(status);
  const stack = document.createElement("div");
  stack.className = "apex-stack";
  const content = document.createElement("div");
  content.className = "apex-stack-content";
  node.__apexState.sections.forEach((section) => {
    content.appendChild(buildSection(node, section));
  });
  stack.appendChild(content);
  root.appendChild(stack);
  node.__apexStack = stack;
  node.__apexStackContent = content;
  scheduleSectionLayout(node);
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

  const root = document.createElement("div");
  root.className = "apex-lora-root";
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  const domWidget = node.addDOMWidget("apex_lora_ui", "apex-lora-ui", root, {
    serialize: false,
    hideOnZoom: false,
    margin: 0,
    getMinHeight: () => 190,
    afterResize: () => scheduleSectionLayout(node),
  });
  domWidget.serializeValue = () => undefined;
  node.__apexRoot = root;
  node.__apexDomWidget = domWidget;
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
  loadCatalog().catch((error) => setStatus(node, error.message, true));
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
    row.name = update.name;
    row.sha256 = update.sha256;
    row.size = update.size;
    delete row.error;
    changed += 1;
  }
  if (changed) {
    commit(node, { presetDirty: false });
    setStatus(node, `Updated ${changed} renamed LoRA${changed === 1 ? "" : "s"}.`);
  }
}


api.addEventListener("apex-lora-loader/resolved", handleRuntimeResolution);

app.registerExtension({
  name: "apex.ApexLoraLoader",
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
      const widget = dataWidget(this);
      if (widget) widget.value = serializeState(this.__apexState);
      renderNode(this);
      setTimeout(() => resolveNodeLoras(this, false), 0);
      return result;
    };
    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeOpenPopover();
      if (dragPayload?.node === this) dragPayload = null;
      clearDragFeedback();
      if (this.__apexLayoutFrame != null) cancelAnimationFrame(this.__apexLayoutFrame);
      this.__apexLayoutFrame = null;
      this.__apexBuilt = false;
      return originalRemoved?.apply(this, arguments);
    };
  },
});
