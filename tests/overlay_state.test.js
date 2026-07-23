import test from "node:test";
import assert from "node:assert/strict";

import { previewDisplayName, previewSummary } from "../web/overlay_state.js";


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
