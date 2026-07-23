import assert from "node:assert/strict";
import test from "node:test";

import {
  addPresetJob,
  applySnapshotToLoaderState,
  createJobsState,
  duplicateJob,
  groupAdjacentJobs,
  moveJobsAround,
  normalizeJobsState,
  removeJob,
  serializeJobsState,
  setGroupCount,
  snapshotFromPreset,
} from "../web/preset_jobs_state.js";

const hash = (letter) => letter.repeat(64);

function preset(id, name, entries = []) {
  return { id, name, type: "active", entries };
}

function entry(name, letter, strength = 1) {
  return { name, sha256: hash(letter), size: 10, strength };
}

function loaderState(rows) {
  return {
    version: 1,
    folder_filters: null,
    active_preset_id: "current",
    settings: {},
    sections: [{
      id: "section",
      name: "Section",
      collapsed: false,
      column: 0,
      loras: rows.map((row, index) => ({
        id: `row-${index}`,
        enabled: true,
        strength: 1,
        trigger_words: [],
        active_trigger_words: [],
        trigger_position: "append",
        ...row,
      })),
    }],
  };
}

test("active presets become frozen snapshots and full presets are rejected", () => {
  const source = preset("p1", "Portrait", [entry("a.safetensors", "a", 0.75)]);
  const snapshot = snapshotFromPreset(source);
  source.name = "Renamed";
  source.entries[0].strength = 2;
  assert.equal(snapshot.name, "Portrait");
  assert.equal(snapshot.entries[0].strength, 0.75);
  assert.throws(() => snapshotFromPreset({ ...source, type: "full" }), /Only active-state/);
});

test("jobs serialize with stable order and normalize duplicate IDs", () => {
  const state = createJobsState();
  const first = addPresetJob(state, preset("a", "A", [entry("a.safetensors", "a")]));
  const second = addPresetJob(state, preset("b", "B", []));
  const restored = normalizeJobsState(serializeJobsState(state));
  assert.deepEqual(restored.jobs.map((job) => job.preset.name), ["A", "B"]);
  restored.jobs[1].id = restored.jobs[0].id;
  const normalized = normalizeJobsState(restored);
  assert.notEqual(normalized.jobs[0].id, normalized.jobs[1].id);
  assert.equal(first.preset.source_id, "a");
  assert.equal(second.preset.entries.length, 0);
});

test("duplicate, removal, and block movement preserve explicit order", () => {
  const state = createJobsState();
  const a = addPresetJob(state, preset("a", "A"));
  const b = addPresetJob(state, preset("b", "B"));
  const copy = duplicateJob(state, a.id);
  assert.deepEqual(state.jobs.map((job) => job.preset.name), ["A", "A", "B"]);
  assert.notEqual(copy.id, a.id);
  moveJobsAround(state, [a.id, copy.id], b.id, true);
  assert.deepEqual(state.jobs.map((job) => job.preset.name), ["B", "A", "A"]);
  assert.equal(removeJob(state, b.id), true);
  assert.deepEqual(state.jobs.map((job) => job.preset.name), ["A", "A"]);
});

test("grouped view combines adjacent identical snapshots only", () => {
  const state = createJobsState();
  const a1 = addPresetJob(state, preset("a", "A"));
  duplicateJob(state, a1.id);
  addPresetJob(state, preset("b", "B"));
  addPresetJob(state, preset("a", "A"));
  let groups = groupAdjacentJobs(state.jobs);
  assert.deepEqual(groups.map((group) => [group.preset.name, group.jobs.length]), [["A", 2], ["B", 1], ["A", 1]]);
  setGroupCount(state, groups[0].jobs[0].id, 4);
  groups = groupAdjacentJobs(state.jobs);
  assert.deepEqual(groups.map((group) => [group.preset.name, group.jobs.length]), [["A", 4], ["B", 1], ["A", 1]]);
  setGroupCount(state, groups[0].jobs[0].id, 1);
  assert.deepEqual(groupAdjacentJobs(state.jobs).map((group) => [group.preset.name, group.jobs.length]), [["A", 1], ["B", 1], ["A", 1]]);
});

test("snapshot application disables unmatched rows and restores strengths", () => {
  const base = loaderState([
    entry("folder/a.safetensors", "a", 1),
    entry("b.safetensors", "b", 1),
    entry("c.safetensors", "c", 1),
  ]);
  const snapshot = snapshotFromPreset(preset("p", "Use A and C", [
    entry("old-name.safetensors", "a", 0.45),
    entry("c.safetensors", "c", -1.25),
  ]));
  const result = applySnapshotToLoaderState(base, snapshot);
  const rows = result.state.sections[0].loras;
  assert.deepEqual(rows.map((row) => row.enabled), [true, false, true]);
  assert.deepEqual(rows.map((row) => row.strength), [0.45, 1, -1.25]);
  assert.equal(result.state.active_preset_id, null);
  assert.deepEqual(result.missing, []);
});

test("changed files, missing entries, duplicate LoRAs, and empty presets are deterministic", () => {
  const base = loaderState([
    entry("same.safetensors", "a"),
    entry("same.safetensors", "b"),
  ]);
  const changed = snapshotFromPreset(preset("p", "Changed", [entry("same.safetensors", "f", 0.5)]));
  const changedResult = applySnapshotToLoaderState(base, changed);
  assert.equal(changedResult.missing[0].name, "same.safetensors");

  const duplicate = snapshotFromPreset(preset("d", "Duplicate", [
    entry("old-a.safetensors", "a", 0.5),
    entry("old-b.safetensors", "b", 0.75),
  ]));
  const duplicateResult = applySnapshotToLoaderState(base, duplicate);
  assert.deepEqual(duplicateResult.state.sections[0].loras.map((row) => row.strength), [0.5, 0.75]);

  const missing = applySnapshotToLoaderState(base, snapshotFromPreset(preset("m", "Missing", [entry("nope.safetensors", "f")])));
  assert.equal(missing.missing[0].name, "nope.safetensors");

  const empty = applySnapshotToLoaderState(base, snapshotFromPreset(preset("e", "Off", [])));
  assert.deepEqual(empty.state.sections[0].loras.map((row) => row.enabled), [false, false]);
});
