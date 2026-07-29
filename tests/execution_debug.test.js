import test from "node:test";
import assert from "node:assert/strict";

import { logCachedExecution, logExecutionReport } from "../web/execution_debug.js";


function fakeConsole() {
  const calls = [];
  const target = {};
  for (const method of ["groupCollapsed", "groupEnd", "table", "info", "warn", "error"]) {
    target[method] = (...args) => calls.push([method, ...args]);
  }
  return { calls, target };
}


test("runtime report tables distinguish installed, unmatched, skipped, and failed rows", () => {
  const { calls, target } = fakeConsole();
  logExecutionReport({
    node_id: "42",
    applied: [{
      order: 1,
      section: "Style",
      requested_name: "old.safetensors",
      resolved_name: "new.safetensors",
      strength: 0.75,
      renamed: true,
      model_patch_keys: 12,
      model_patch_entries: 12,
    }],
    unmatched: [{
      order: 2,
      section: "Style",
      requested_name: "wrong.safetensors",
      resolved_name: "wrong.safetensors",
      strength: 1,
    }],
    skipped: [{
      order: 3,
      section: "Style",
      requested_name: "muted.safetensors",
      strength: 0,
      reason: "Temporary 0.00 override",
    }],
    failed: [{
      order: 4,
      section: "Style",
      requested_name: "missing.safetensors",
      strength: 1,
      error: "FileNotFoundError: missing",
    }],
  }, target);

  assert.match(calls[0][1], /Apex LoRA Loader #42/);
  assert.match(calls[0][1], /1 applied, 1 unmatched, 1 skipped, 1 failed/);
  const tables = calls.filter(([method]) => method === "table").map(([, rows]) => rows);
  assert.equal(tables.length, 4);
  assert.deepEqual(tables[0][0], {
    Order: 1,
    Section: "Style",
    LoRA: "new.safetensors",
    Strength: "0.75",
    "Patch keys": 12,
    "Patch entries": 12,
    Renamed: "yes",
  });
  assert.equal(tables[2][0].Reason, "Temporary 0.00 override");
});


test("cache notice explicitly says no new core calls were made", () => {
  const { calls, target } = fakeConsole();
  logCachedExecution(7, target);
  assert.deepEqual(calls.map(([method]) => method), ["info"]);
  assert.match(calls[0][1], /#7/);
  assert.match(calls[0][1], /no new core LoRA loading calls/);
});

