import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREVIEW_ROW_LIMIT,
  duplicateIdentityGroups,
  previewDisplayName,
  previewRowLimit,
  previewSummary,
  previewSummaryTooltip,
} from "../web/overlay_state.js";


function section(id, name, collapsed, loras) {
  return { id, name, collapsed, loras };
}


function row(id, enabled, strength, extra = {}) {
  return {
    id,
    name: `${id}.safetensors`,
    enabled,
    strength,
    trigger_words: [],
    active_trigger_words: [],
    ...extra,
  };
}


test("preview includes enabled rows in execution order and ignores section collapse", () => {
  const summary = previewSummary({
    sections: [
      section("a", "First", true, [
        row("a1", true, 1),
        row("a2", false, 1),
      ]),
      section("b", "Second", false, [
        row("b1", true, 0),
        row("b2", true, -0.5),
      ]),
    ],
  });

  assert.deepEqual(summary.rows.map((entry) => entry.id), ["a1", "b1", "b2"]);
  assert.deepEqual(summary.rows.map((entry) => entry.sectionName), ["First", "Second", "Second"]);
  assert.equal(summary.sectionCount, 2);
  assert.equal(summary.enabledSections, 2);
  assert.equal(summary.totalRows, 4);
  assert.equal(summary.enabledRows, 3);
  assert.equal(summary.effectiveRows, 2);
  assert.equal(summary.zeroStrengthRows, 1);
});


test("preview caps rows and surfaces errors, inactive strengths, and trigger counts", () => {
  const summary = previewSummary({
    sections: [
      section("a", "LoRAs", false, [
        row("one", true, 0, {
          error: "Missing",
          trigger_words: ["first", "second"],
          active_trigger_words: ["second"],
        }),
        row("two", true, 1),
        row("three", true, 1),
      ]),
    ],
  }, { limit: 2 });

  assert.equal(summary.rows.length, 2);
  assert.equal(summary.overflow, 1);
  assert.equal(summary.errorRows, 1);
  assert.equal(summary.rows[0].effective, false);
  assert.equal(summary.rows[0].triggerWordCount, 2);
  assert.equal(summary.rows[0].activeTriggerWordCount, 1);
});


test("preview reports a muted row as enabled but not effective", () => {
  const summary = previewSummary({
    sections: [
      section("a", "LoRAs", false, [
        row("muted", true, 0.85, { muted: true }),
        row("plain", true, 0.85),
        row("off", false, 1, { muted: true }),
      ]),
    ],
  });

  assert.deepEqual(summary.rows.map((entry) => entry.id), ["muted", "plain"]);
  assert.equal(summary.enabledRows, 2);
  assert.equal(summary.effectiveRows, 1);
  assert.equal(summary.mutedRows, 1);
  assert.equal(summary.zeroStrengthRows, 0);
  assert.equal(summary.rows[0].muted, true);
  assert.equal(summary.rows[0].effective, false);
  // The configured strength stays visible while the override is active.
  assert.equal(summary.rows[0].strength, 0.85);
  assert.equal(summary.rows[1].muted, false);
  assert.equal(summary.rows[1].effective, true);
});


test("unmuting transfers a row from muted to active without changing its saved strength", () => {
  const target = row("style", true, 0.85, { muted: true });
  const state = { sections: [section("a", "Styles", false, [target])] };

  const muted = previewSummary(state);
  assert.equal(muted.enabledRows, 1);
  assert.equal(muted.effectiveRows, 0);
  assert.equal(muted.mutedRows, 1);

  target.muted = false;
  const restored = previewSummary(state);
  assert.equal(restored.enabledRows, 1);
  assert.equal(restored.effectiveRows, 1);
  assert.equal(restored.mutedRows, 0);
  assert.equal(restored.rows[0].strength, 0.85);
});


test("preview tooltip explains selected, active, muted, zero-strength, and total counts", () => {
  const summary = previewSummary({
    sections: [
      section("a", "Styles", false, [
        row("active", true, 1),
        row("muted", true, 0.75, { muted: true }),
        row("zero", true, 0),
        row("disabled", false, 1, { muted: true }),
      ]),
    ],
  });

  assert.equal(
    previewSummaryTooltip(summary),
    "1 section, 3 checkbox-enabled LoRAs, 1 active LoRA, "
      + "1 temporarily muted LoRA, 1 at 0.00 strength, 4 total LoRAs",
  );
});


test("duplicate identities are grouped across sections regardless of filename or enabled state", () => {
  const duplicateHash = "a".repeat(64);
  const summary = previewSummary({
    sections: [
      section("styles", "Styles", false, [
        row("first", true, 1, {
          name: "styles/original.safetensors",
          sha256: duplicateHash.toUpperCase(),
        }),
      ]),
      section("details", "Details", false, [
        row("second", false, 0.5, {
          name: "copies/renamed.safetensors",
          sha256: duplicateHash,
        }),
        row("unknown", true, 1, { sha256: "" }),
      ]),
    ],
  });

  assert.equal(summary.duplicateGroups.length, 1);
  assert.equal(summary.duplicateRows, 2);
  assert.deepEqual(
    summary.duplicateGroups[0].rows.map((entry) => entry.name),
    ["styles/original.safetensors", "copies/renamed.safetensors"],
  );
  assert.match(previewSummaryTooltip(summary), /1 duplicate identity set/);
  assert.match(
    previewSummaryTooltip(summary),
    /Styles \/ styles\/original\.safetensors = Details \/ copies\/renamed\.safetensors/,
  );
});


test("duplicate detection ignores repeated logical rows but keeps distinct same-name rows", () => {
  const duplicateHash = "b".repeat(64);
  const repeated = row("stable-row", true, 1, {
    name: "styles/same.safetensors",
    sha256: duplicateHash,
  });
  const repeatedState = {
    sections: [section("styles", "Styles", false, [repeated, repeated])],
  };
  assert.deepEqual(duplicateIdentityGroups(repeatedState), []);

  const distinctState = {
    sections: [
      section("styles", "Styles", false, [
        repeated,
        row("second-row", false, 0.5, {
          name: "styles/same.safetensors",
          sha256: duplicateHash,
        }),
      ]),
    ],
  };
  const groups = duplicateIdentityGroups(distinctState);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((entry) => entry.id), [
    "stable-row",
    "second-row",
  ]);
});


test("duplicate detection ignores missing identities and single verified hashes", () => {
  const state = {
    sections: [
      section("a", "LoRAs", false, [
        row("one", true, 1, { sha256: "a".repeat(64) }),
        row("two", true, 1, { sha256: "not-a-hash" }),
        row("three", true, 1),
      ]),
    ],
  };

  assert.deepEqual(duplicateIdentityGroups(state), []);
});


test("preview shows up to twenty enabled rows by default", () => {
  const summary = previewSummary({
    sections: [
      section(
        "a",
        "LoRAs",
        false,
        Array.from({ length: 23 }, (_, index) => row(`row-${index + 1}`, true, 1)),
      ),
    ],
  });

  assert.equal(summary.enabledRows, 23);
  assert.equal(summary.rows.length, 20);
  assert.equal(summary.overflow, 3);
});


test("the configured preview limit controls enabled rows and never exceeds 99", () => {
  const sections = [
    section(
      "a",
      "LoRAs",
      false,
      Array.from({ length: 139 }, (_, index) => row(`row-${index + 1}`, true, 1)),
    ),
  ];

  const capped = previewSummary({ sections, settings: {} });
  assert.equal(capped.rows.length, DEFAULT_PREVIEW_ROW_LIMIT);
  assert.equal(capped.overflow, 119);

  const custom = previewSummary({
    sections,
    settings: { preview_lora_limit: 37 },
  });
  assert.equal(custom.enabledRows, 139);
  assert.equal(custom.rows.length, 37);
  assert.equal(custom.overflow, 102);
  assert.equal(custom.totalRows, 139);

  const maximum = previewSummary({
    sections,
    settings: { preview_lora_limit: 1000 },
  });
  assert.equal(maximum.rows.length, 99);
  assert.equal(maximum.overflow, 40);
});


test("an explicit limit still overrides the configured node preview limit", () => {
  const state = {
    sections: [
      section("a", "LoRAs", false, [
        row("one", true, 1),
        row("two", true, 1),
        row("three", true, 1),
      ]),
    ],
    settings: { preview_lora_limit: 99 },
  };

  const summary = previewSummary(state, { limit: 1 });
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.overflow, 2);
});


test("previewRowLimit normalizes custom limits and migrates the legacy show-all toggle", () => {
  assert.equal(previewRowLimit(undefined), DEFAULT_PREVIEW_ROW_LIMIT);
  assert.equal(previewRowLimit({}), DEFAULT_PREVIEW_ROW_LIMIT);
  assert.equal(previewRowLimit({ show_all_enabled_loras: false }), DEFAULT_PREVIEW_ROW_LIMIT);
  assert.equal(previewRowLimit({ show_all_enabled_loras: "yes" }), DEFAULT_PREVIEW_ROW_LIMIT);
  assert.equal(previewRowLimit({ show_all_enabled_loras: true }), 99);
  assert.equal(previewRowLimit({ preview_lora_limit: 4 }), 5);
  assert.equal(previewRowLimit({ preview_lora_limit: 44.6 }), 45);
  assert.equal(previewRowLimit({ preview_lora_limit: 100 }), 99);
  assert.equal(previewRowLimit({ preview_lora_limit: 0 }), 99);
  assert.equal(previewRowLimit({ preview_lora_limit: -1 }), 99);
});


test("preview names respect path and extension display settings", () => {
  const name = "nested/styles/Detail.SAFETENSORS";
  assert.equal(previewDisplayName(name, {}), "Detail");
  assert.equal(previewDisplayName(name, { show_safetensors: true }), "Detail.SAFETENSORS");
  assert.equal(previewDisplayName(name, { show_folder_paths: true }), "nested/styles/Detail");
  assert.equal(
    previewDisplayName(name, { show_folder_paths: true, show_safetensors: true }),
    "nested/styles/Detail.SAFETENSORS",
  );
  assert.equal(previewDisplayName("plain-name", {}), "plain-name");
  assert.equal(previewDisplayName("\\folder\\item.safetensors", { show_folder_paths: true }), "/folder/item");
  assert.equal(previewDisplayName(null, {}), "");
});
