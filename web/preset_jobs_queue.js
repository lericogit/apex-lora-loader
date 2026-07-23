export const IDLE_RUN_CONTEXT = "";

export function runContextFromPrompt(prompt, nodeClass = "ApexPresetJobs") {
  for (const entry of Object.values(prompt?.output || {})) {
    if (entry?.class_type !== nodeClass) continue;
    const raw = entry.inputs?.run_context;
    if (typeof raw !== "string" || !raw) continue;
    try {
      const context = JSON.parse(raw);
      if (typeof context?.batch_id === "string" && context.batch_id
        && typeof context?.job_id === "string" && context.job_id) {
        return { batch_id: context.batch_id, job_id: context.job_id };
      }
    } catch {
      // Other nodes and ordinary queue submissions pass straight through.
    }
  }
  return null;
}

export function createQueueCursor({
  batchId,
  validJobs,
  stackWidget,
  runWidget,
  baseValue,
  onSubmitting = () => {},
}) {
  let index = 0;
  return {
    beforeQueued() {
      const item = validJobs[index];
      if (!item) return null;
      stackWidget.value = item.serialized;
      if (runWidget) {
        runWidget.value = JSON.stringify({ batch_id: batchId, job_id: item.job.id });
      }
      onSubmitting(item);
      return item;
    },
    afterQueued() {
      stackWidget.value = baseValue;
      if (runWidget) runWidget.value = IDLE_RUN_CONTEXT;
      index += 1;
    },
    restore() {
      stackWidget.value = baseValue;
      if (runWidget) runWidget.value = IDLE_RUN_CONTEXT;
    },
    get index() {
      return index;
    },
  };
}
