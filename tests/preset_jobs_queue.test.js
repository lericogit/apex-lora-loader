import assert from "node:assert/strict";
import test from "node:test";

import {
  createQueueCursor,
  IDLE_RUN_CONTEXT,
  runContextFromPrompt,
} from "../web/preset_jobs_queue.js";

test("queue cursor substitutes jobs in order and restores both widgets", () => {
  const stackWidget = { value: "base" };
  const runWidget = { value: IDLE_RUN_CONTEXT };
  const seen = [];
  const cursor = createQueueCursor({
    batchId: "batch",
    validJobs: [
      { job: { id: "one" }, serialized: "state-one" },
      { job: { id: "two" }, serialized: "state-two" },
    ],
    stackWidget,
    runWidget,
    baseValue: "base",
    onSubmitting: (item) => seen.push(item.job.id),
  });

  cursor.beforeQueued();
  assert.equal(stackWidget.value, "state-one");
  assert.deepEqual(JSON.parse(runWidget.value), { batch_id: "batch", job_id: "one" });
  cursor.afterQueued();
  assert.equal(stackWidget.value, "base");
  assert.equal(runWidget.value, "");

  cursor.beforeQueued();
  assert.equal(stackWidget.value, "state-two");
  cursor.restore();
  assert.equal(stackWidget.value, "base");
  assert.equal(runWidget.value, "");
  assert.deepEqual(seen, ["one", "two"]);
});

test("prompt context is detected only on valid Apex helper output", () => {
  const prompt = {
    output: {
      1: { class_type: "Other", inputs: { run_context: "{}" } },
      2: {
        class_type: "ApexPresetJobs",
        inputs: { run_context: JSON.stringify({ batch_id: "batch", job_id: "job" }) },
      },
    },
  };
  assert.deepEqual(runContextFromPrompt(prompt), { batch_id: "batch", job_id: "job" });
  assert.equal(runContextFromPrompt({ output: { 2: { class_type: "ApexPresetJobs", inputs: { run_context: "bad" } } } }), null);
  assert.equal(runContextFromPrompt(prompt, "DifferentClass"), null);
});
