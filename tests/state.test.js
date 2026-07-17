import assert from "node:assert/strict";
import test from "node:test";

import {
  addTriggerWord,
  applyPreset,
  masonryLayout,
  matchesFolderFilters,
  moveRow,
  moveSection,
  normalizeState,
  normalizeStrength,
  normalizeTriggerMetadata,
  normalizeTriggerPosition,
  removeTriggerWord,
  serializeState,
  strengthFromDrag,
  toggleTriggerWord,
} from "../web/state.js";


function row(id, name, hash, enabled = true, strength = 1) {
  return { id, name, sha256: hash, size: 4, enabled, strength };
}

function sampleState() {
  return {
    version: 1,
    folder_filters: null,
    active_preset_id: null,
    sections: [
      { id: "s1", name: "One", collapsed: false, loras: [row("a", "root.safetensors", "a".repeat(64)), row("b", "x/b.safetensors", "b".repeat(64))] },
      { id: "s2", name: "Two", collapsed: false, loras: [row("c", "x/y/c.safetensors", "c".repeat(64))] },
    ],
  };
}


test("folder filters support root, multiple folders, and recursive prefixes", () => {
  assert.equal(matchesFolderFilters("root.safetensors", null), true);
  assert.equal(matchesFolderFilters("root.safetensors", [""]), true);
  assert.equal(matchesFolderFilters("x/a.safetensors", [""]), false);
  assert.equal(matchesFolderFilters("x/y/a.safetensors", ["x"]), true);
  assert.equal(matchesFolderFilters("z/a.safetensors", ["x", "styles"]), false);
  assert.equal(matchesFolderFilters("x/a.safetensors", []), false);
});


test("horizontal strength dragging is precise and clamped", () => {
  assert.equal(strengthFromDrag(1, 2.99), 1);
  assert.equal(strengthFromDrag(1, 3), 1.01);
  assert.equal(strengthFromDrag(1, 5.99), 1.01);
  assert.equal(strengthFromDrag(1, 6), 1.02);
  assert.equal(strengthFromDrag(1, -3), 0.99);
  assert.equal(strengthFromDrag(1, 12, 0.1), 1.4);
  assert.equal(strengthFromDrag(1, -12, 0.001), 0.96);
  assert.equal(strengthFromDrag(1, 30, 0.025), 1.3);
  assert.equal(strengthFromDrag(1, 21, 0.03), 1.21);
  assert.equal(strengthFromDrag(0.57, 6, 0.05), 0.67);
  assert.equal(strengthFromDrag(99.9, 300), 100);
  assert.equal(strengthFromDrag(-99.9, -300), -100);
  assert.equal(normalizeStrength(3.457475457), 3.46);
  assert.equal(normalizeStrength(-0.5733), -0.57);
});


test("masonry layout stacks each section under the shortest column", () => {
  assert.deepEqual(masonryLayout([100, 300, 80, 50], 2, 6), {
    items: [
      { column: 0, y: 0 },
      { column: 1, y: 0 },
      { column: 0, y: 106 },
      { column: 0, y: 192 },
    ],
    height: 300,
  });
});


test("node display settings normalize and serialize with safe defaults", () => {
  const state = sampleState();
  state.settings = {
    show_safetensors: false,
    show_folder_paths: false,
    show_trigger_button: true,
    strength_drag_step: 0.05,
  };
  const normalized = normalizeState(state);
  assert.deepEqual(normalized.settings, state.settings);
  assert.deepEqual(JSON.parse(serializeState(normalized)).settings, state.settings);

  state.settings.strength_drag_step = 0.057;
  assert.equal(normalizeState(state).settings.strength_drag_step, 0.06);

  delete state.settings;
  assert.deepEqual(normalizeState(state).settings, {
    show_safetensors: true,
    show_folder_paths: true,
    show_trigger_button: false,
    strength_drag_step: 0.01,
  });
});


test("legacy trigger words migrate to the canonical trigger array", () => {
  const state = sampleState();
  state.sections[0].loras[0].trigger_word = "  portrait style  ";
  const normalized = normalizeState(state);
  const rowState = normalized.sections[0].loras[0];
  assert.deepEqual(rowState.trigger_words, ["portrait style"]);
  assert.deepEqual(rowState.active_trigger_words, ["portrait style"]);
  const serialized = JSON.parse(serializeState(normalized)).sections[0].loras[0];
  assert.deepEqual(serialized.trigger_words, ["portrait style"]);
  assert.deepEqual(serialized.active_trigger_words, ["portrait style"]);
  assert.equal("trigger_word" in serialized, false);
  assert.equal("active_trigger_word" in serialized, false);
});


test("trigger metadata trims, deduplicates, and repairs invalid selection", () => {
  assert.deepEqual(normalizeTriggerMetadata({
    trigger_words: [" first ", "second", "first", "", 12, "third"],
    active_trigger_words: [" third ", "second", "missing", "second"],
  }), {
    trigger_words: ["first", "second", "third"],
    active_trigger_words: ["second", "third"],
  });
  assert.deepEqual(normalizeTriggerMetadata({
    trigger_words: ["one", "two"],
    active_trigger_word: " two ",
  }), {
    trigger_words: ["one", "two"],
    active_trigger_words: ["two"],
  });
  assert.deepEqual(normalizeTriggerMetadata({
    trigger_words: ["one", "two"],
    active_trigger_words: [],
  }), {
    trigger_words: ["one", "two"],
    active_trigger_words: [],
  });
});


test("trigger chips add, toggle, and remove words deterministically", () => {
  let metadata = addTriggerWord({}, " first ");
  metadata = addTriggerWord(metadata, "second");
  metadata = addTriggerWord(metadata, "first");
  assert.deepEqual(metadata, {
    trigger_words: ["first", "second"],
    active_trigger_words: ["first", "second"],
  });

  metadata = toggleTriggerWord(metadata, "second");
  assert.deepEqual(metadata.active_trigger_words, ["first"]);
  metadata = toggleTriggerWord(metadata, "first");
  assert.deepEqual(metadata.active_trigger_words, []);
  metadata = toggleTriggerWord(metadata, "second");
  assert.deepEqual(metadata.active_trigger_words, ["second"]);
  metadata = removeTriggerWord(metadata, "first");
  assert.deepEqual(metadata, {
    trigger_words: ["second"],
    active_trigger_words: ["second"],
  });
  metadata = removeTriggerWord(metadata, "second");
  assert.deepEqual(metadata, {
    trigger_words: [],
    active_trigger_words: [],
  });
});


test("trigger prompt position is row-local and defaults to append", () => {
  const state = sampleState();
  state.sections[0].loras[0].trigger_position = "prepend";
  state.sections[0].loras[1].trigger_position = "invalid";
  const normalized = normalizeState(state);
  assert.equal(normalized.sections[0].loras[0].trigger_position, "prepend");
  assert.equal(normalized.sections[0].loras[1].trigger_position, "append");
  assert.equal(normalized.sections[1].loras[0].trigger_position, "append");
  assert.equal(normalizeTriggerPosition("prepend"), "prepend");
  assert.equal(normalizeTriggerPosition("anything else"), "append");
  const serialized = JSON.parse(serializeState(normalized));
  assert.equal(serialized.sections[0].loras[0].trigger_position, "prepend");
});


test("sections and rows move without changing their contents", () => {
  const state = sampleState();
  assert.equal(moveSection(state, "s2", 0), true);
  assert.deepEqual(state.sections.map((section) => section.id), ["s2", "s1"]);
  assert.equal(moveRow(state, "a", "s2", 1), true);
  assert.deepEqual(state.sections[0].loras.map((item) => item.id), ["c", "a"]);
  assert.deepEqual(state.sections[1].loras.map((item) => item.id), ["b"]);
});


test("sections and rows can move downward to the end", () => {
  const state = sampleState();
  assert.equal(moveSection(state, "s1", 2), true);
  assert.deepEqual(state.sections.map((section) => section.id), ["s2", "s1"]);
  assert.equal(moveRow(state, "a", "s1", 2), true);
  assert.deepEqual(state.sections[1].loras.map((item) => item.id), ["b", "a"]);
});


test("preset application disables unmatched rows and preserves structure", () => {
  const state = sampleState();
  state.sections[1].loras[0].trigger_position = "prepend";
  const result = applyPreset(state, {
    id: "preset",
    entries: [
      { name: "renamed.safetensors", sha256: "c".repeat(64), strength: 0.35 },
      { name: "absent.safetensors", sha256: "d".repeat(64), strength: 1.2 },
    ],
  });
  assert.deepEqual(result, { matched: 1, missing: 1 });
  assert.deepEqual(state.sections.map((section) => section.id), ["s1", "s2"]);
  assert.equal(state.sections[0].loras.every((item) => item.enabled === false), true);
  assert.equal(state.sections[1].loras[0].enabled, true);
  assert.equal(state.sections[1].loras[0].strength, 0.35);
  assert.equal(state.sections[1].loras[0].trigger_position, "prepend");
  assert.equal(state.active_preset_id, "preset");
});


test("a changed file with the same name is not treated as the preset identity", () => {
  const state = sampleState();
  const result = applyPreset(state, {
    id: "changed",
    entries: [{ name: "root.safetensors", sha256: "f".repeat(64), strength: 2 }],
  });
  assert.deepEqual(result, { matched: 0, missing: 1 });
  assert.equal(state.sections[0].loras[0].enabled, false);
});


test("duplicate identities are matched in row order and transient errors are not serialized", () => {
  const state = sampleState();
  state.sections[0].loras.push(row("a2", "copy.safetensors", "a".repeat(64)));
  state.sections[0].loras[0].error = "missing";
  applyPreset(state, {
    id: "dupes",
    entries: [
      { name: "first", sha256: "a".repeat(64), strength: 0.2 },
      { name: "second", sha256: "a".repeat(64), strength: 0.7 },
    ],
  });
  assert.equal(state.sections[0].loras[0].strength, 0.2);
  assert.equal(state.sections[0].loras[2].strength, 0.7);
  assert.equal(serializeState(state).includes("missing"), false);
});
