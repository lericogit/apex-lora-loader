import assert from "node:assert/strict";
import test from "node:test";

import {
  addSection,
  addTriggerWord,
  assignSectionColumns,
  applyFullPreset,
  applyPreset,
  createSection,
  insertionIndexFromMidpoints,
  fullPresetStateFromState,
  matchesFolderFilters,
  moveRow,
  moveSection,
  normalizeState,
  normalizeStrength,
  normalizeTriggerMetadata,
  normalizeTriggerPosition,
  removeTriggerWord,
  responsiveColumnCount,
  sectionsByVisibleColumn,
  serializeState,
  strengthFromDrag,
  toggleSectionRows,
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


test("section toggle enables mixed rows and disables fully enabled rows", () => {
  const section = sampleState().sections[0];
  section.loras[1].enabled = false;

  assert.equal(toggleSectionRows(section), true);
  assert.equal(section.loras.every((item) => item.enabled), true);
  assert.equal(toggleSectionRows(section), false);
  assert.equal(section.loras.every((item) => !item.enabled), true);
});


test("responsive section columns change only at minimum-width breakpoints", () => {
  assert.equal(responsiveColumnCount(200, 6, 320, 6), 1);
  assert.equal(responsiveColumnCount(645, 6, 320, 6), 1);
  assert.equal(responsiveColumnCount(646, 6, 320, 6), 2);
  assert.equal(responsiveColumnCount(971, 6, 320, 6), 2);
  assert.equal(responsiveColumnCount(972, 6, 320, 6), 3);
  assert.equal(responsiveColumnCount(2000, 2, 320, 6), 2);
});


test("legacy sections receive stable contiguous columns and serialize them", () => {
  const state = normalizeState({
    ...sampleState(),
    sections: [
      ...sampleState().sections,
      { id: "s3", name: "Three", collapsed: false, loras: [] },
      { id: "s4", name: "Four", collapsed: false, loras: [] },
      { id: "s5", name: "Five", collapsed: false, loras: [] },
    ],
  });
  assert.equal(assignSectionColumns(state, 1), false);
  assert.deepEqual(state.sections.map((section) => section.column), [null, null, null, null, null]);
  assert.deepEqual(
    JSON.parse(serializeState(state)).sections.map((section) => section.column),
    [null, null, null, null, null],
  );
  assert.equal(assignSectionColumns(state, 2), true);
  assert.deepEqual(state.sections.map((section) => section.column), [0, 0, 0, 1, 1]);
  assert.equal(assignSectionColumns(state, 2), false);
  assert.deepEqual(
    JSON.parse(serializeState(state)).sections.map((section) => section.column),
    [0, 0, 0, 1, 1],
  );
});


test("partial column migration restores canonical visual execution order", () => {
  const state = sampleState();
  state.sections[0].column = 1;
  state.sections[1].column = null;
  assert.equal(assignSectionColumns(state, 2), true);
  assert.deepEqual(state.sections.map((section) => [section.id, section.column]), [
    ["s2", 0],
    ["s1", 1],
  ]);
  assert.deepEqual(
    sectionsByVisibleColumn(state, 2).flat().map((section) => section.id),
    state.sections.map((section) => section.id),
  );
});


test("preferred columns merge responsively and restore without mutating state", () => {
  const state = sampleState();
  state.sections.push({ id: "s3", name: "Three", column: 2, collapsed: false, loras: [] });
  state.sections[0].column = 0;
  state.sections[1].column = 1;
  assert.deepEqual(
    sectionsByVisibleColumn(state, 3).map((lane) => lane.map((section) => section.id)),
    [["s1"], ["s2"], ["s3"]],
  );
  assert.deepEqual(
    sectionsByVisibleColumn(state, 2).map((lane) => lane.map((section) => section.id)),
    [["s1"], ["s2", "s3"]],
  );
  assert.deepEqual(state.sections.map((section) => section.column), [0, 1, 2]);
});


test("drop insertion uses every point before, between, and after rows", () => {
  assert.equal(insertionIndexFromMidpoints(5, []), 0);
  assert.equal(insertionIndexFromMidpoints(5, [10, 30, 50]), 0);
  assert.equal(insertionIndexFromMidpoints(10, [10, 30, 50]), 1);
  assert.equal(insertionIndexFromMidpoints(29, [10, 30, 50]), 1);
  assert.equal(insertionIndexFromMidpoints(40, [10, 30, 50]), 2);
  assert.equal(insertionIndexFromMidpoints(60, [10, 30, 50]), 3);
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
  assert.equal(moveSection(state, "s2", 0, 0), true);
  assert.deepEqual(state.sections.map((section) => section.id), ["s2", "s1"]);
  assert.equal(moveRow(state, "a", "s2", 1), true);
  assert.deepEqual(state.sections[0].loras.map((item) => item.id), ["c", "a"]);
  assert.deepEqual(state.sections[1].loras.map((item) => item.id), ["b"]);
});


test("sections and rows can move downward to the end", () => {
  const state = sampleState();
  assert.equal(moveSection(state, "s1", 0, 2), true);
  assert.deepEqual(state.sections.map((section) => section.id), ["s2", "s1"]);
  assert.equal(moveRow(state, "a", "s1", 2), true);
  assert.deepEqual(state.sections[1].loras.map((item) => item.id), ["b", "a"]);
});


test("rows move into empty sections and invalid destinations restore the source", () => {
  const state = sampleState();
  state.sections.push({ id: "empty", name: "Empty", column: 0, collapsed: false, loras: [] });
  assert.equal(moveRow(state, "a", "empty", 0), true);
  assert.deepEqual(state.sections[0].loras.map((item) => item.id), ["b"]);
  assert.deepEqual(state.sections[2].loras.map((item) => item.id), ["a"]);
  assert.equal(moveRow(state, "a", "missing", 0), false);
  assert.deepEqual(state.sections[2].loras.map((item) => item.id), ["a"]);
});


test("sections move within and between manual columns in visual execution order", () => {
  const state = sampleState();
  state.sections[0].column = 0;
  state.sections[1].column = 1;
  const third = createSection("Three", 1);
  third.id = "s3";
  addSection(state, third, 1);
  assert.deepEqual(state.sections.map((section) => [section.id, section.column]), [
    ["s1", 0],
    ["s2", 1],
    ["s3", 1],
  ]);
  assert.equal(moveSection(state, "s1", 1, 1), true);
  assert.deepEqual(state.sections.map((section) => [section.id, section.column]), [
    ["s2", 1],
    ["s1", 1],
    ["s3", 1],
  ]);
  assert.equal(moveSection(state, "s3", 0, 0), true);
  assert.deepEqual(state.sections.map((section) => [section.id, section.column]), [
    ["s3", 0],
    ["s2", 1],
    ["s1", 1],
  ]);
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


test("full preset snapshots preserve the complete normalized setup only", () => {
  const state = sampleState();
  state.active_preset_id = "currently-selected";
  state.folder_filters = ["styles", ""];
  state.settings = {
    show_safetensors: false,
    show_folder_paths: true,
    show_trigger_button: true,
    strength_drag_step: 0.057,
  };
  state.sections[0].collapsed = true;
  state.sections[0].column = 1;
  state.sections[0].loras[0].enabled = false;
  state.sections[0].loras[0].strength = 0.456;
  state.sections[0].loras[0].trigger_words = ["portrait", "detail"];
  state.sections[0].loras[0].active_trigger_words = ["detail"];
  state.sections[0].loras[0].trigger_position = "prepend";
  state.sections[0].loras[0].error = "missing";
  state.unknown = "discard";

  const snapshot = fullPresetStateFromState(state);

  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.folder_filters, ["styles", ""]);
  assert.deepEqual(snapshot.settings, {
    show_safetensors: false,
    show_folder_paths: true,
    show_trigger_button: true,
    strength_drag_step: 0.06,
  });
  assert.deepEqual(snapshot.sections.map((section) => section.id), ["s1", "s2"]);
  assert.deepEqual(snapshot.sections[0].loras.map((item) => item.id), ["a", "b"]);
  assert.equal(snapshot.sections[0].collapsed, true);
  assert.equal(snapshot.sections[0].column, 1);
  assert.equal(snapshot.sections[0].loras[0].enabled, false);
  assert.equal(snapshot.sections[0].loras[0].strength, 0.46);
  assert.deepEqual(snapshot.sections[0].loras[0].active_trigger_words, ["detail"]);
  assert.equal(snapshot.sections[0].loras[0].trigger_position, "prepend");
  assert.equal("active_preset_id" in snapshot, false);
  assert.equal("error" in snapshot.sections[0].loras[0], false);
  assert.equal("unknown" in snapshot, false);
});


test("full preset application replaces the setup and selects the preset", () => {
  const state = normalizeState(sampleState());
  state.sections[0].loras[0].error = "old transient error";
  const presetState = fullPresetStateFromState(normalizeState({
    version: 1,
    folder_filters: ["characters"],
    active_preset_id: "must-not-leak",
    settings: {
      show_safetensors: false,
      show_folder_paths: false,
      show_trigger_button: true,
      strength_drag_step: 0.05,
    },
    sections: [
      {
        id: "saved-two",
        name: "Second saved section",
        collapsed: true,
        column: 1,
        loras: [row("saved-b", "saved/B.safetensors", "e".repeat(64), false, -0.25)],
      },
      {
        id: "saved-one",
        name: "First saved section",
        collapsed: false,
        column: 0,
        loras: [row("saved-a", "saved/A.safetensors", "d".repeat(64), true, 0.75)],
      },
    ],
  }));
  presetState.sections[1].loras[0].trigger_words = ["saved trigger"];
  presetState.sections[1].loras[0].active_trigger_words = ["saved trigger"];
  presetState.sections[1].loras[0].trigger_position = "prepend";

  applyFullPreset(state, {
    id: "full-preset",
    name: "Complete setup",
    type: "full",
    state: presetState,
  });

  assert.equal(state.active_preset_id, "full-preset");
  assert.deepEqual(state.folder_filters, ["characters"]);
  assert.deepEqual(state.settings, presetState.settings);
  assert.deepEqual(state.sections.map((section) => section.id), ["saved-two", "saved-one"]);
  assert.deepEqual(state.sections.map((section) => section.column), [1, 0]);
  assert.deepEqual(state.sections.map((section) => section.collapsed), [true, false]);
  assert.deepEqual(state.sections[0].loras.map((item) => item.id), ["saved-b"]);
  assert.equal(state.sections[0].loras[0].enabled, false);
  assert.equal(state.sections[0].loras[0].strength, -0.25);
  assert.deepEqual(state.sections[1].loras[0].active_trigger_words, ["saved trigger"]);
  assert.equal(state.sections[1].loras[0].trigger_position, "prepend");
  assert.equal(serializeState(state).includes("root.safetensors"), false);

  presetState.sections[0].name = "mutated after apply";
  assert.equal(state.sections[0].name, "Second saved section");
});
