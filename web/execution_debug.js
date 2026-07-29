function consoleMethod(target, name, fallback = "log") {
  if (typeof target?.[name] === "function") return target[name].bind(target);
  if (typeof target?.[fallback] === "function") return target[fallback].bind(target);
  return () => {};
}


function appliedRows(entries) {
  return entries.map((entry) => ({
    Order: entry.order,
    Section: entry.section,
    LoRA: entry.resolved_name,
    Strength: Number(entry.strength).toFixed(2),
    "Patch keys": entry.model_patch_keys ?? "unavailable",
    "Patch entries": entry.model_patch_entries ?? "unavailable",
    Renamed: entry.renamed ? "yes" : "",
  }));
}


function skippedRows(entries) {
  return entries.map((entry) => ({
    Order: entry.order,
    Section: entry.section,
    LoRA: entry.requested_name,
    "Saved strength": Number(entry.strength).toFixed(2),
    Reason: entry.reason,
  }));
}


function problemRows(entries) {
  return entries.map((entry) => ({
    Order: entry.order,
    Section: entry.section,
    LoRA: entry.resolved_name || entry.requested_name,
    Strength: Number(entry.strength).toFixed(2),
    Problem: entry.error || "Comfy core matched no compatible model patch keys",
  }));
}


export function logExecutionReport(report, target = globalThis.console) {
  if (!report || typeof report !== "object") return;
  const applied = Array.isArray(report.applied) ? report.applied : [];
  const unmatched = Array.isArray(report.unmatched) ? report.unmatched : [];
  const skipped = Array.isArray(report.skipped) ? report.skipped : [];
  const failed = Array.isArray(report.failed) ? report.failed : [];
  const nodeLabel = report.node_id == null ? "" : ` #${report.node_id}`;
  const summary = `${applied.length} applied, ${unmatched.length} unmatched, `
    + `${skipped.length} skipped${failed.length ? `, ${failed.length} failed` : ""}`;

  const group = consoleMethod(target, "groupCollapsed");
  const groupEnd = consoleMethod(target, "groupEnd");
  const table = consoleMethod(target, "table");
  const info = consoleMethod(target, "info");
  const warn = consoleMethod(target, "warn");
  const error = consoleMethod(target, "error");

  group(`[Apex LoRA Loader${nodeLabel}] Core execution report — ${summary}`);
  if (applied.length) {
    info("Applied by Comfy core (actual ModelPatcher contributions):");
    table(appliedRows(applied));
  } else {
    info("No LoRA patches were installed by this execution.");
  }
  if (unmatched.length) {
    warn("Core was called for these files, but it installed zero compatible model patches:");
    table(problemRows(unmatched));
  }
  if (skipped.length) {
    info("Not sent to Comfy core:");
    table(skippedRows(skipped));
  }
  if (failed.length) {
    error("LoRA loading stopped on an error:");
    table(problemRows(failed));
  }
  groupEnd();
}


export function logCachedExecution(nodeId, target = globalThis.console) {
  consoleMethod(target, "info")(
    `[Apex LoRA Loader #${nodeId}] ComfyUI reused this node's cached patched-model output; `
    + "no new core LoRA loading calls were made for this execution.",
  );
}

