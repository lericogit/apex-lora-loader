import { normalizeTriggerMetadata } from "./state.js";

export const DEFAULT_PREVIEW_ROW_LIMIT = 20;


function finiteStrength(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}


export function previewDisplayName(name, settings = {}) {
  const canonical = typeof name === "string" ? name.replaceAll("\\", "/") : "";
  const separator = canonical.lastIndexOf("/");
  const path = separator === -1 ? "" : canonical.slice(0, separator + 1);
  const file = separator === -1 ? canonical : canonical.slice(separator + 1);
  const visibleFile = settings.show_safetensors
    ? file
    : file.replace(/\.safetensors$/i, "");
  return settings.show_folder_paths && path ? `${path}${visibleFile}` : visibleFile;
}


export function previewRowLimit(settings) {
  return settings?.show_all_enabled_loras === true
    ? Infinity
    : DEFAULT_PREVIEW_ROW_LIMIT;
}


export function previewSummary(state, { limit } = {}) {
  const sections = Array.isArray(state?.sections) ? state.sections : [];
  // An explicit limit always wins so callers and tests stay in control; the
  // node's own setting only decides the default.
  const requested = limit === undefined ? previewRowLimit(state?.settings) : limit;
  const safeLimit = requested === Infinity
    ? Infinity
    : Math.max(0, Math.trunc(Number(requested) || 0));
  const visibleRows = [];
  let totalRows = 0;
  let enabledRows = 0;
  let enabledSections = 0;
  let effectiveRows = 0;
  let mutedRows = 0;
  let errorRows = 0;

  for (const section of sections) {
    const sourceRows = Array.isArray(section?.loras) ? section.loras : [];
    totalRows += sourceRows.length;
    let sectionEnabled = false;
    for (const row of sourceRows) {
      if (!row?.enabled) continue;
      sectionEnabled = true;
      enabledRows += 1;
      const strength = finiteStrength(row.strength);
      const muted = row.muted === true;
      const effective = !muted && strength !== 0;
      if (effective) effectiveRows += 1;
      if (muted) mutedRows += 1;
      if (row.error) errorRows += 1;
      if (visibleRows.length < safeLimit) {
        const triggerMetadata = normalizeTriggerMetadata(row);
        visibleRows.push({
          id: String(row.id ?? ""),
          name: String(row.name ?? ""),
          sectionId: String(section.id ?? ""),
          sectionName: String(section.name ?? ""),
          strength,
          muted,
          effective,
          error: row.error ? String(row.error) : "",
          triggerWordCount: triggerMetadata.trigger_words.length,
          activeTriggerWordCount: triggerMetadata.active_trigger_words.length,
        });
      }
    }
    if (sectionEnabled) enabledSections += 1;
  }

  return {
    sectionCount: sections.length,
    enabledSections,
    totalRows,
    enabledRows,
    effectiveRows,
    mutedRows,
    errorRows,
    rows: visibleRows,
    overflow: Math.max(0, enabledRows - visibleRows.length),
  };
}
