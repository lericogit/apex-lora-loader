export const STATE_VERSION = 1;
export const STRENGTH_DRAG_PIXELS_PER_TICK = 3;
export const DEFAULT_SETTINGS = Object.freeze({
  show_safetensors: true,
  show_folder_paths: true,
  show_trigger_button: false,
  strength_drag_step: 0.01,
  overlay_scale: 0.88,
});

function roundToTwo(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeStrength(value, fallback = 1) {
  const strength = Number(value);
  if (!Number.isFinite(strength)) return fallback;
  return Math.max(-100, Math.min(100, roundToTwo(strength)));
}

export function formatStrength(value) {
  return normalizeStrength(value, 0).toFixed(2).replace(".", ",");
}

export function parseStrengthInput(value) {
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const strength = Number(normalized);
  return Number.isFinite(strength) ? normalizeStrength(strength) : null;
}

export function normalizeTriggerMetadata(value = {}) {
  const source = Array.isArray(value?.trigger_words)
    ? value.trigger_words
    : typeof value?.trigger_word === "string"
      ? [value.trigger_word]
      : [];
  const triggerWords = [];
  const seen = new Set();
  for (const item of source) {
    if (typeof item !== "string") continue;
    const word = item.trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    triggerWords.push(word);
  }
  let activeSource;
  if (Array.isArray(value?.active_trigger_words)) {
    activeSource = value.active_trigger_words;
  } else if (typeof value?.active_trigger_word === "string" && value.active_trigger_word.trim()) {
    activeSource = [value.active_trigger_word];
  } else if (typeof value?.trigger_word === "string" && value.trigger_word.trim()) {
    activeSource = [value.trigger_word];
  } else if (!Object.prototype.hasOwnProperty.call(value || {}, "active_trigger_words")) {
    activeSource = triggerWords.slice(0, 1);
  } else {
    activeSource = [];
  }
  const activeSet = new Set(
    activeSource
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return {
    trigger_words: triggerWords,
    active_trigger_words: triggerWords.filter((word) => activeSet.has(word)),
  };
}

export function addTriggerWord(value, word) {
  const metadata = normalizeTriggerMetadata(value);
  const added = typeof word === "string" ? word.trim() : "";
  if (!added) return metadata;
  if (!metadata.trigger_words.includes(added)) metadata.trigger_words.push(added);
  return normalizeTriggerMetadata({
    trigger_words: metadata.trigger_words,
    active_trigger_words: [...metadata.active_trigger_words, added],
  });
}

export function removeTriggerWord(value, word) {
  const metadata = normalizeTriggerMetadata(value);
  const index = metadata.trigger_words.indexOf(word);
  if (index === -1) return metadata;
  metadata.trigger_words.splice(index, 1);
  return normalizeTriggerMetadata({
    trigger_words: metadata.trigger_words,
    active_trigger_words: metadata.active_trigger_words.filter((item) => item !== word),
  });
}

export function toggleTriggerWord(value, word) {
  const metadata = normalizeTriggerMetadata(value);
  if (!metadata.trigger_words.includes(word)) return metadata;
  const active = new Set(metadata.active_trigger_words);
  if (active.has(word)) active.delete(word);
  else active.add(word);
  return normalizeTriggerMetadata({
    trigger_words: metadata.trigger_words,
    active_trigger_words: [...active],
  });
}

export function normalizeTriggerPosition(value) {
  return value === "prepend" ? "prepend" : "append";
}

function normalizeDragStep(value) {
  const dragStep = Number(value);
  return Number.isFinite(dragStep)
    ? Math.max(0.01, Math.min(100, roundToTwo(dragStep)))
    : DEFAULT_SETTINGS.strength_drag_step;
}

function normalizeOverlayScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale)
    ? Math.max(0.5, Math.min(1, roundToTwo(scale)))
    : DEFAULT_SETTINGS.overlay_scale;
}

export function normalizeSettings(value) {
  return {
    show_safetensors: value?.show_safetensors !== false,
    show_folder_paths: value?.show_folder_paths !== false,
    show_trigger_button: value?.show_trigger_button === true,
    strength_drag_step: normalizeDragStep(value?.strength_drag_step),
    overlay_scale: normalizeOverlayScale(value?.overlay_scale),
  };
}

export function makeId() {
  return crypto.randomUUID();
}

export function createSection(name = "LoRAs", column = 0) {
  return {
    id: makeId(),
    name,
    collapsed: false,
    column: Number.isInteger(column) && column >= 0 ? column : 0,
    loras: [],
  };
}

export function createState() {
  return {
    version: STATE_VERSION,
    folder_filters: null,
    active_preset_id: null,
    settings: normalizeSettings(),
    sections: [createSection()],
  };
}

export function createRow(identity) {
  const triggerMetadata = normalizeTriggerMetadata(identity);
  return {
    id: makeId(),
    name: identity.name,
    enabled: true,
    strength: 1,
    sha256: identity.sha256,
    size: identity.size,
    ...triggerMetadata,
    trigger_position: normalizeTriggerPosition(identity.trigger_position),
  };
}

export function normalizeState(value) {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return createState();
    }
  }
  if (!data || data.version !== STATE_VERSION || !Array.isArray(data.sections)) {
    return createState();
  }
  const state = {
    version: STATE_VERSION,
    folder_filters: data.folder_filters === null
      ? null
      : Array.isArray(data.folder_filters)
        ? [...new Set(data.folder_filters.filter((item) => typeof item === "string"))]
        : null,
    active_preset_id: typeof data.active_preset_id === "string" ? data.active_preset_id : null,
    settings: normalizeSettings(data.settings),
    sections: data.sections.map((section, sectionIndex) => ({
      id: typeof section?.id === "string" ? section.id : makeId(),
      name: typeof section?.name === "string" && section.name.trim()
        ? section.name.trim()
        : `Section ${sectionIndex + 1}`,
      collapsed: section?.collapsed === true,
      column: Number.isInteger(section?.column) && section.column >= 0 ? section.column : null,
      loras: Array.isArray(section?.loras)
        ? section.loras.filter((row) => row && typeof row.name === "string").map((row) => ({
            id: typeof row.id === "string" ? row.id : makeId(),
            name: row.name.replaceAll("\\", "/"),
            enabled: row.enabled === true,
            strength: normalizeStrength(row.strength),
            sha256: typeof row.sha256 === "string" ? row.sha256 : "",
            size: Number.isInteger(row.size) && row.size >= 0 ? row.size : 0,
            ...normalizeTriggerMetadata(row),
            trigger_position: normalizeTriggerPosition(row.trigger_position),
            error: typeof row.error === "string" ? row.error : undefined,
          }))
        : [],
    })),
  };
  if (!state.sections.length) state.sections.push(createSection());
  return state;
}

export function serializeState(state) {
  return JSON.stringify({
    version: STATE_VERSION,
    folder_filters: state.folder_filters,
    active_preset_id: state.active_preset_id,
    settings: normalizeSettings(state.settings),
    sections: state.sections.map((section) => ({
      id: section.id,
      name: section.name,
      collapsed: section.collapsed,
      column: Number.isInteger(section.column) && section.column >= 0 ? section.column : null,
      loras: section.loras.map(({ error, ...row }) => row),
    })),
  });
}

export function allRows(state) {
  return state.sections.flatMap((section) => section.loras);
}

export function toggleSectionRows(section) {
  const enable = !section.loras.some((row) => row.enabled);
  for (const row of section.loras) row.enabled = enable;
  return enable;
}

export function folderOf(name) {
  const normalized = String(name).replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function matchesFolderFilters(name, filters) {
  if (filters === null) return true;
  if (!Array.isArray(filters) || !filters.length) return false;
  const folder = folderOf(name);
  return filters.some((prefix) => {
    if (prefix === "") return folder === "";
    return folder === prefix || folder.startsWith(`${prefix}/`);
  });
}

export function strengthFromDrag(startValue, deltaX, step = DEFAULT_SETTINGS.strength_drag_step) {
  const movement = Number(deltaX);
  const ticks = Number.isFinite(movement)
    ? Math.trunc(movement / STRENGTH_DRAG_PIXELS_PER_TICK)
    : 0;
  const startUnits = Math.round(normalizeStrength(startValue) * 100);
  const stepUnits = Math.round(normalizeDragStep(step) * 100);
  const valueUnits = Math.max(-10000, Math.min(10000, startUnits + ticks * stepUnits));
  return valueUnits / 100;
}

export function strengthFillParts(value) {
  const strength = normalizeStrength(value, 0);
  const magnitude = Math.abs(strength);
  const whole = Math.floor(magnitude);
  const exactInteger = magnitude > 0 && magnitude === whole;
  return {
    negative: strength < 0,
    fraction: exactInteger ? 100 : roundToTwo((magnitude - whole) * 100),
    blocks: Math.min(10, exactInteger ? whole - 1 : whole),
  };
}

export function responsiveColumnCount(width, sectionCount, minimum = 320, gap = 6) {
  const available = Math.max(1, Number(width) || 1);
  const sections = Math.max(1, Math.floor(Number(sectionCount) || 1));
  const minWidth = Math.max(1, Number(minimum) || 320);
  const spacing = Math.max(0, Number(gap) || 0);
  return Math.min(sections, Math.max(1, Math.floor((available + spacing) / (minWidth + spacing))));
}

export function sectionColumn(section) {
  return Number.isInteger(section?.column) && section.column >= 0 ? section.column : 0;
}

export function assignSectionColumns(state, columnCount) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  const missing = state.sections.filter((section) => !Number.isInteger(section.column) || section.column < 0);
  if (!missing.length) return false;
  if (columns === 1) return false;

  if (missing.length === state.sections.length) {
    const base = Math.floor(state.sections.length / columns);
    let remainder = state.sections.length % columns;
    let sectionIndex = 0;
    for (let column = 0; column < columns; column += 1) {
      const size = base + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      for (let index = 0; index < size; index += 1) {
        state.sections[sectionIndex].column = column;
        sectionIndex += 1;
      }
    }
    return true;
  }

  const counts = Array(columns).fill(0);
  for (const section of state.sections) {
    if (Number.isInteger(section.column) && section.column >= 0) {
      counts[Math.min(section.column, columns - 1)] += 1;
    }
  }
  for (const section of missing) {
    const smallest = Math.min(...counts);
    const column = counts.indexOf(smallest);
    section.column = column;
    counts[column] += 1;
  }
  state.sections.sort((left, right) => sectionColumn(left) - sectionColumn(right));
  return true;
}

export function sectionsByVisibleColumn(state, columnCount) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  const lanes = Array.from({ length: columns }, () => []);
  for (const section of state.sections) {
    lanes[Math.min(sectionColumn(section), columns - 1)].push(section);
  }
  return lanes;
}

export function addSection(state, section, column = 0) {
  const targetColumn = Math.max(0, Math.floor(Number(column) || 0));
  section.column = targetColumn;
  const nextColumn = state.sections.findIndex((item) => sectionColumn(item) > targetColumn);
  state.sections.splice(nextColumn === -1 ? state.sections.length : nextColumn, 0, section);
}

export function moveSection(state, sectionId, targetColumn, targetIndex) {
  const sourceIndex = state.sections.findIndex((section) => section.id === sectionId);
  if (sourceIndex === -1) return false;
  const column = Math.max(0, Math.floor(Number(targetColumn) || 0));
  const sourceColumn = sectionColumn(state.sections[sourceIndex]);
  const sourceColumnIndex = state.sections
    .filter((section) => sectionColumn(section) === sourceColumn)
    .findIndex((section) => section.id === sectionId);
  const [section] = state.sections.splice(sourceIndex, 1);
  const targetSections = state.sections.filter((item) => sectionColumn(item) === column);
  let index = Math.floor(Number(targetIndex) || 0);
  if (sourceColumn === column && sourceColumnIndex < index) index -= 1;
  index = Math.max(0, Math.min(index, targetSections.length));
  section.column = column;

  let insertionIndex;
  if (index < targetSections.length) {
    insertionIndex = state.sections.indexOf(targetSections[index]);
  } else {
    insertionIndex = state.sections.findIndex((item) => sectionColumn(item) > column);
    if (insertionIndex === -1) insertionIndex = state.sections.length;
  }
  state.sections.splice(insertionIndex, 0, section);
  return true;
}

export function insertionIndexFromMidpoints(position, midpoints) {
  const value = Number(position);
  if (!Number.isFinite(value)) return midpoints.length;
  const index = midpoints.findIndex((midpoint) => value < midpoint);
  return index === -1 ? midpoints.length : index;
}

export function moveRow(state, rowId, targetSectionId, targetIndex) {
  let row = null;
  let sourceSection = null;
  let sourceIndex = -1;
  for (const section of state.sections) {
    const index = section.loras.findIndex((item) => item.id === rowId);
    if (index !== -1) {
      sourceSection = section;
      sourceIndex = index;
      [row] = section.loras.splice(index, 1);
      break;
    }
  }
  const targetSection = state.sections.find((section) => section.id === targetSectionId);
  if (!row || !targetSection) {
    if (row && sourceSection) sourceSection.loras.splice(sourceIndex, 0, row);
    return false;
  }
  let index = targetIndex;
  if (sourceSection === targetSection && sourceIndex < index) index -= 1;
  index = Math.max(0, Math.min(index, targetSection.loras.length));
  targetSection.loras.splice(index, 0, row);
  return true;
}

export function presetEntriesFromState(state) {
  return allRows(state)
    .filter((row) => row.enabled)
    .map((row) => ({
      name: row.name,
      sha256: row.sha256,
      size: row.size,
      strength: normalizeStrength(row.strength),
    }));
}

export function presetType(preset) {
  return preset?.type === "full" ? "full" : "active";
}

export function fullPresetStateFromState(state) {
  const snapshot = JSON.parse(serializeState(normalizeState(state)));
  delete snapshot.active_preset_id;
  return snapshot;
}

export function applyFullPreset(state, preset) {
  if (presetType(preset) !== "full" || preset?.state?.version !== STATE_VERSION || !Array.isArray(preset.state.sections)) {
    throw new Error("Full preset state has an unsupported format.");
  }
  const replacement = normalizeState({
    ...preset.state,
    active_preset_id: preset.id,
  });
  state.version = replacement.version;
  state.folder_filters = replacement.folder_filters;
  state.settings = replacement.settings;
  state.sections = replacement.sections;
  state.active_preset_id = preset.id;
  return {
    sections: state.sections.length,
    loras: allRows(state).length,
  };
}

export function applyPreset(state, preset) {
  const rows = allRows(state);
  const used = new Set();
  for (const row of rows) row.enabled = false;

  let matched = 0;
  for (const entry of preset.entries || []) {
    let index = rows.findIndex(
      (row, rowIndex) => !used.has(rowIndex) && entry.sha256 && row.sha256 === entry.sha256,
    );
    if (index === -1 && !/^[0-9a-f]{64}$/i.test(entry.sha256 || "")) {
      index = rows.findIndex(
        (row, rowIndex) =>
          !used.has(rowIndex) && row.name === entry.name && !/^[0-9a-f]{64}$/i.test(row.sha256 || ""),
      );
    }
    if (index === -1) continue;
    used.add(index);
    rows[index].enabled = true;
    rows[index].strength = normalizeStrength(entry.strength);
    matched += 1;
  }
  state.active_preset_id = preset.id;
  return { matched, missing: (preset.entries || []).length - matched };
}
