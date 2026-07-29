import {
  DEFAULT_PREVIEW_LORA_LIMIT,
  normalizePreviewLoraLimit,
  normalizeTriggerMetadata,
} from "./state.js";

export const DEFAULT_PREVIEW_ROW_LIMIT = DEFAULT_PREVIEW_LORA_LIMIT;


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
  return normalizePreviewLoraLimit(
    settings?.preview_lora_limit,
    settings?.show_all_enabled_loras,
  );
}


function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}


export function duplicateIdentityGroups(state) {
  const byHash = new Map();
  const seenLogicalRows = new Set();
  for (const section of Array.isArray(state?.sections) ? state.sections : []) {
    for (const row of Array.isArray(section?.loras) ? section.loras : []) {
      if (!validSha256(row?.sha256)) continue;
      const rowId = typeof row?.id === "string" ? row.id : "";
      const sectionId = typeof section?.id === "string" ? section.id : "";
      // A repeated reference to the same stable row is corrupted/stale state,
      // not a second loaded LoRA. Distinct rows still count as duplicates even
      // when their filename is identical.
      const logicalKey = rowId ? `${sectionId}\u0000${rowId}` : "";
      if (logicalKey && seenLogicalRows.has(logicalKey)) continue;
      if (logicalKey) seenLogicalRows.add(logicalKey);
      const sha256 = row.sha256.toLowerCase();
      if (!byHash.has(sha256)) byHash.set(sha256, []);
      byHash.get(sha256).push({
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        sectionId: String(section.id ?? ""),
        sectionName: String(section.name ?? ""),
        enabled: row.enabled === true,
        strength: finiteStrength(row.strength),
      });
    }
  }
  return [...byHash]
    .filter(([, rows]) => rows.length > 1)
    .map(([sha256, rows]) => ({ sha256, rows }))
    .sort((left, right) => {
      const leftName = left.rows[0]?.name || "";
      const rightName = right.rows[0]?.name || "";
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base" })
        || leftName.localeCompare(rightName);
    });
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
  let zeroStrengthRows = 0;
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
      else if (strength === 0) zeroStrengthRows += 1;
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

  const duplicateGroups = duplicateIdentityGroups(state);
  return {
    sectionCount: sections.length,
    enabledSections,
    totalRows,
    enabledRows,
    effectiveRows,
    mutedRows,
    zeroStrengthRows,
    errorRows,
    duplicateGroups,
    duplicateRows: duplicateGroups.reduce((total, group) => total + group.rows.length, 0),
    rows: visibleRows,
    overflow: Math.max(0, enabledRows - visibleRows.length),
  };
}


function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}


export function previewSummaryTooltip(summary) {
  const details = [
    countLabel(summary.sectionCount, "section"),
    countLabel(summary.enabledRows, "checkbox-enabled LoRA"),
    countLabel(summary.effectiveRows, "active LoRA"),
    countLabel(summary.mutedRows, "temporarily muted LoRA"),
    `${summary.zeroStrengthRows} at 0.00 strength`,
    countLabel(summary.totalRows, "total LoRA"),
  ];
  const groups = Array.isArray(summary.duplicateGroups) ? summary.duplicateGroups : [];
  if (groups.length) {
    details.push(countLabel(groups.length, "duplicate identity set"));
    const visible = groups.slice(0, 5).map((group) => (
      group.rows
        .map((row) => `${row.sectionName || "Unnamed section"} / ${row.name || "Unnamed LoRA"}`)
        .join(" = ")
    ));
    const remaining = groups.length - visible.length;
    details.push(`Duplicates: ${visible.join("; ")}${remaining ? `; +${remaining} more` : ""}`);
  }
  return details.join(", ");
}
