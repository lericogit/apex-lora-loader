import {
  allRows,
  normalizeState,
  normalizeStrength,
  serializeState,
} from "./state.js";

export const JOBS_STATE_VERSION = 1;
export const MAX_JOBS = 2048;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function makeId() {
  return globalThis.crypto?.randomUUID?.()
    || `apex-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEntry(entry) {
  if (!entry || typeof entry.name !== "string" || !entry.name.trim()) return null;
  if (!HASH_PATTERN.test(entry.sha256 || "")) return null;
  if (!Number.isInteger(entry.size) || entry.size < 0) return null;
  return {
    name: entry.name.replaceAll("\\", "/"),
    sha256: entry.sha256.toLowerCase(),
    size: entry.size,
    strength: normalizeStrength(entry.strength),
  };
}

export function snapshotFromPreset(preset) {
  if (!preset || (preset.type || "active") !== "active") {
    throw new Error("Only active-state presets can be added to Preset Jobs.");
  }
  if (typeof preset.name !== "string" || !preset.name.trim()) {
    throw new Error("Preset snapshots require a name.");
  }
  if (!Array.isArray(preset.entries)) {
    throw new Error(`Preset “${preset.name}” has invalid entries.`);
  }
  const entries = preset.entries.map(normalizeEntry);
  if (entries.some((entry) => entry === null)) {
    throw new Error(`Preset “${preset.name}” contains a LoRA without a valid identity.`);
  }
  return {
    source_id: typeof preset.id === "string" ? preset.id : null,
    name: preset.name.trim().slice(0, 100),
    entries,
  };
}

function normalizeSnapshot(preset) {
  if (!preset || typeof preset.name !== "string" || !preset.name.trim()) return null;
  if (!Array.isArray(preset.entries)) return null;
  const entries = preset.entries.map(normalizeEntry);
  if (entries.some((entry) => entry === null)) return null;
  return {
    source_id: typeof preset.source_id === "string" ? preset.source_id : null,
    name: preset.name.trim().slice(0, 100),
    entries,
  };
}

export function createJobsState() {
  return { version: JOBS_STATE_VERSION, view: "expanded", jobs: [] };
}

export function normalizeJobsState(value) {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return createJobsState();
    }
  }
  if (!data || data.version !== JOBS_STATE_VERSION || !Array.isArray(data.jobs)) {
    return createJobsState();
  }
  const seen = new Set();
  const jobs = [];
  for (const item of data.jobs.slice(0, MAX_JOBS)) {
    const preset = normalizeSnapshot(item?.preset);
    if (!preset) continue;
    let id = typeof item.id === "string" && item.id.trim() ? item.id : makeId();
    if (seen.has(id)) id = makeId();
    seen.add(id);
    jobs.push({ id, preset });
  }
  return {
    version: JOBS_STATE_VERSION,
    view: data.view === "grouped" ? "grouped" : "expanded",
    jobs,
  };
}

export function serializeJobsState(state) {
  return JSON.stringify(normalizeJobsState(state));
}

export function addPresetJob(state, preset, index = state.jobs.length) {
  if (state.jobs.length >= MAX_JOBS) throw new Error(`Preset Jobs supports at most ${MAX_JOBS} runs.`);
  const job = { id: makeId(), preset: snapshotFromPreset(preset) };
  const target = Math.max(0, Math.min(Number(index) || 0, state.jobs.length));
  state.jobs.splice(target, 0, job);
  return job;
}

export function duplicateJob(state, jobId) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  if (state.jobs.length >= MAX_JOBS) throw new Error(`Preset Jobs supports at most ${MAX_JOBS} runs.`);
  const job = { id: makeId(), preset: clone(state.jobs[index].preset) };
  state.jobs.splice(index + 1, 0, job);
  return job;
}

export function removeJob(state, jobId) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return false;
  state.jobs.splice(index, 1);
  return true;
}

export function moveJob(state, jobId, targetIndex) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return false;
  const [job] = state.jobs.splice(index, 1);
  let target = Math.max(0, Math.min(Number(targetIndex) || 0, state.jobs.length));
  if (index < targetIndex) target -= 1;
  target = Math.max(0, Math.min(target, state.jobs.length));
  state.jobs.splice(target, 0, job);
  return true;
}

export function moveJobsAround(state, sourceIds, targetJobId, after = false) {
  const selected = new Set(sourceIds);
  if (!selected.size || selected.has(targetJobId)) return false;
  const moving = state.jobs.filter((job) => selected.has(job.id));
  if (!moving.length) return false;
  const remaining = state.jobs.filter((job) => !selected.has(job.id));
  const targetIndex = remaining.findIndex((job) => job.id === targetJobId);
  if (targetIndex === -1) return false;
  remaining.splice(targetIndex + (after ? 1 : 0), 0, ...moving);
  state.jobs = remaining;
  return true;
}

export function snapshotKey(preset) {
  return JSON.stringify({
    source_id: preset.source_id,
    name: preset.name,
    entries: preset.entries,
  });
}

export function groupAdjacentJobs(jobs) {
  const groups = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const key = snapshotKey(job.preset);
    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.jobs.push(job);
      previous.end = index + 1;
    } else {
      groups.push({ key, preset: job.preset, jobs: [job], start: index, end: index + 1 });
    }
  }
  return groups;
}

export function setGroupCount(state, firstJobId, count) {
  const group = groupAdjacentJobs(state.jobs).find((item) => item.jobs[0]?.id === firstJobId);
  if (!group) return false;
  const desired = Math.max(1, Math.min(MAX_JOBS, Math.trunc(Number(count) || 1)));
  const available = MAX_JOBS - (state.jobs.length - group.jobs.length);
  const nextCount = Math.min(desired, available);
  const replacements = group.jobs.slice(0, nextCount);
  while (replacements.length < nextCount) {
    replacements.push({ id: makeId(), preset: clone(group.preset) });
  }
  state.jobs.splice(group.start, group.jobs.length, ...replacements);
  return true;
}

export function applySnapshotToLoaderState(baseValue, snapshot) {
  const state = normalizeState(baseValue);
  const rows = allRows(state);
  const used = new Set();
  const missing = [];
  for (const row of rows) row.enabled = false;

  for (const entry of snapshot.entries) {
    let index = rows.findIndex(
      (row, rowIndex) => !used.has(rowIndex) && entry.sha256 && row.sha256 === entry.sha256,
    );
    if (index === -1 && !HASH_PATTERN.test(entry.sha256 || "")) {
      index = rows.findIndex(
        (row, rowIndex) => !used.has(rowIndex) && row.name === entry.name,
      );
    }
    if (index === -1) {
      missing.push(entry);
      continue;
    }
    used.add(index);
    rows[index].enabled = true;
    rows[index].strength = normalizeStrength(entry.strength);
  }
  state.active_preset_id = null;
  return {
    state,
    serialized: serializeState(state),
    missing,
  };
}

export function statusSummary(jobs, statuses) {
  const counts = {};
  for (const job of jobs) {
    const status = statuses.get(job.id)?.state || "ready";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}
