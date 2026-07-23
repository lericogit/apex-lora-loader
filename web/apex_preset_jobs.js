import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { allRows, formatStrength, serializeState } from "./state.js";
import {
  createQueueCursor,
  IDLE_RUN_CONTEXT,
  runContextFromPrompt,
} from "./preset_jobs_queue.js";
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
  statusSummary,
} from "./preset_jobs_state.js";

const NODE_CLASS = "ApexPresetJobs";
const LOADER_CLASS = "ApexLoraLoader";
const JOBS_WIDGET = "jobs_data";
const RUN_WIDGET = "run_context";
const DEFAULT_SIZE = [430, 320];

let openPopover = null;
let openPresetPreview = null;
let presetPreviewCloseTimer = null;
let activeSubmission = null;
let queueObserverInstalled = false;
const batches = new Map();
const promptJobs = new Map();

const ICONS = {
  plus: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
  play: [["path", { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]],
  copy: [["rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }], ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }]],
  x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  grip: [["circle", { cx: "9", cy: "6", r: "1" }], ["circle", { cx: "9", cy: "12", r: "1" }], ["circle", { cx: "9", cy: "18", r: "1" }], ["circle", { cx: "15", cy: "6", r: "1" }], ["circle", { cx: "15", cy: "12", r: "1" }], ["circle", { cx: "15", cy: "18", r: "1" }]],
  listChevronsUpDown: [["path", { d: "M3 5h8" }], ["path", { d: "M3 12h8" }], ["path", { d: "M3 19h8" }], ["path", { d: "m15 8 3-3 3 3" }], ["path", { d: "m15 16 3 3 3-3" }]],
  listChevronsDownUp: [["path", { d: "M3 5h8" }], ["path", { d: "M3 12h8" }], ["path", { d: "M3 19h8" }], ["path", { d: "m15 5 3 3 3-3" }], ["path", { d: "m15 19 3-3 3 3" }]],
  trash: [["path", { d: "M10 11v6" }], ["path", { d: "M14 11v6" }], ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }], ["path", { d: "M3 6h18" }], ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]],
  chevron: [["path", { d: "m9 18 6-6-6-6" }]],
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of ICONS[name] || []) {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, value);
    svg.appendChild(child);
  }
  return svg;
}

function iconButton(name, title, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `apex-jobs-icon-button ${className}`.trim();
  button.title = title;
  button.setAttribute("aria-label", title);
  button.appendChild(icon(name));
  return button;
}

function injectStyles() {
  if (document.querySelector("link[data-apex-jobs-styles]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./apex_preset_jobs.css", import.meta.url).href;
  link.dataset.apexJobsStyles = "true";
  document.head.appendChild(link);
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.type = "apex_jobs_hidden";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
  if (widget.inputEl) widget.inputEl.style.display = "none";
  if (widget.element) widget.element.style.display = "none";
}

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name);
}

async function fetchJson(path, options) {
  const response = await api.fetchApi(path, options);
  let data = {};
  try { data = await response.json(); } catch { /* empty response */ }
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}

function closePopover() {
  openPopover?.close?.();
  openPopover = null;
}

function closePresetPreview() {
  if (presetPreviewCloseTimer != null) clearTimeout(presetPreviewCloseTimer);
  presetPreviewCloseTimer = null;
  openPresetPreview?.remove();
  openPresetPreview = null;
}

function schedulePresetPreviewClose() {
  if (presetPreviewCloseTimer != null) clearTimeout(presetPreviewCloseTimer);
  presetPreviewCloseTimer = setTimeout(closePresetPreview, 90);
}

function showPresetPreview(anchor, preset) {
  closePresetPreview();
  const preview = document.createElement("div");
  preview.className = "apex-jobs-preset-preview";
  preview.setAttribute("role", "tooltip");

  const header = document.createElement("div");
  header.className = "apex-jobs-preview-header";
  const title = document.createElement("span");
  title.textContent = preset.name;
  title.title = preset.name;
  const count = document.createElement("span");
  count.textContent = `${preset.entries.length} active`;
  header.append(title, count);

  const list = document.createElement("div");
  list.className = "apex-jobs-preview-list";
  if (!preset.entries.length) {
    const empty = document.createElement("div");
    empty.className = "apex-jobs-preview-empty";
    empty.textContent = "All LoRAs disabled";
    list.appendChild(empty);
  } else {
    for (const entry of preset.entries) {
      const item = document.createElement("div");
      item.className = "apex-jobs-preview-entry";
      const name = document.createElement("span");
      name.className = "apex-jobs-preview-name";
      name.textContent = entry.name;
      name.title = entry.name;
      const strength = document.createElement("span");
      strength.className = "apex-jobs-preview-strength";
      strength.dataset.polarity = entry.strength > 0 ? "positive" : entry.strength < 0 ? "negative" : "zero";
      strength.textContent = formatStrength(entry.strength);
      item.append(name, strength);
      list.appendChild(item);
    }
  }
  preview.append(header, list);
  document.body.appendChild(preview);

  const anchorRect = anchor.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const spaceRight = window.innerWidth - anchorRect.right;
  const left = spaceRight >= previewRect.width + 8
    ? anchorRect.right + 8
    : Math.max(8, anchorRect.left - previewRect.width - 8);
  const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - previewRect.height - 8));
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.addEventListener("pointerenter", () => {
    if (presetPreviewCloseTimer != null) clearTimeout(presetPreviewCloseTimer);
    presetPreviewCloseTimer = null;
  });
  preview.addEventListener("pointerleave", schedulePresetPreviewClose);
  openPresetPreview = preview;
}

function attachPresetPreview(row, preset) {
  row.addEventListener("pointerenter", () => {
    if (!row.classList.contains("dragging")) showPresetPreview(row, preset);
  });
  row.addEventListener("pointerleave", schedulePresetPreviewClose);
}

function createPopover(anchor) {
  closePopover();
  const panel = document.createElement("div");
  panel.className = "apex-jobs-popover";
  document.body.appendChild(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 310))}px`;
  panel.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 330)}px`;
  const onPointerDown = (event) => {
    if (!panel.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const close = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    panel.remove();
    if (openPopover?.panel === panel) openPopover = null;
  };
  queueMicrotask(() => document.addEventListener("pointerdown", onPointerDown, true));
  openPopover = { panel, close };
  return { panel, close };
}

function commit(node, render = true) {
  const data = widget(node, JOBS_WIDGET);
  if (data) data.value = serializeJobsState(node.__apexJobsState);
  node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
  if (render) renderNode(node);
}

function setMessage(node, message = "", error = false) {
  node.__apexJobsMessage = { message, error };
  if (!node.__apexJobsMessageEl) return;
  node.__apexJobsMessageEl.textContent = message;
  node.__apexJobsMessageEl.title = message;
  node.__apexJobsMessageEl.classList.toggle("error", error);
  node.__apexJobsStatusIslandEl?.classList.toggle("error", error);
}

function outputLinks(node) {
  const output = node.outputs?.find((item) => item.type === "APEX_PRESET_JOBS") || node.outputs?.[0];
  return (output?.links || []).map((id) => node.graph?.links?.[id]).filter(Boolean);
}

function targetLoader(node) {
  const links = outputLinks(node);
  if (!links.length) return { error: "Connect Preset Jobs to one Apex LoRA Loader." };
  if (links.length > 1) return { error: "Connect Preset Jobs to only one loader." };
  const link = links[0];
  const target = node.graph?.getNodeById?.(link.target_id)
    || node.graph?._nodes_by_id?.[link.target_id]
    || node.graph?._nodes?.find((item) => item.id === link.target_id);
  const input = target?.inputs?.[link.target_slot];
  if (!target || target.type !== LOADER_CLASS || input?.name !== "preset_jobs") {
    return { error: "The output must connect to an Apex LoRA Loader preset_jobs input." };
  }
  const stackWidget = widget(target, "stack_data");
  if (!stackWidget) return { error: "The connected loader has no stack state." };
  return { target, stackWidget };
}

function nodeCanSubmit(node) {
  if (node.mode != null && node.mode !== 0) return "Enable the Preset Jobs node before queueing.";
  if (!node.__apexJobsState.jobs.length) return "Add at least one preset job.";
  return targetLoader(node).error || null;
}

function statusText(status) {
  const state = status?.state || "ready";
  return state.replaceAll("_", " ");
}

function groupStatus(group, statuses) {
  const counts = statusSummary(group.jobs, statuses);
  const keys = Object.keys(counts);
  if (keys.length === 1) return `${group.jobs.length > 1 ? `${group.jobs.length} ` : ""}${statusText({ state: keys[0] })}`;
  return keys.map((key) => `${counts[key]} ${statusText({ state: key })}`).join(" · ");
}

function refreshRuntimeUI(node) {
  for (const [jobId, elements] of node.__apexJobsStatusEls || []) {
    const status = node.__apexJobsStatuses.get(jobId) || { state: "ready" };
    for (const element of elements) {
      element.textContent = statusText(status);
      element.dataset.state = status.state;
      element.title = status.detail || statusText(status);
    }
  }
  for (const item of node.__apexJobsGroupStatusEls || []) {
    item.element.textContent = groupStatus(item.group, node.__apexJobsStatuses);
    const states = new Set(item.group.jobs.map((job) => node.__apexJobsStatuses.get(job.id)?.state || "ready"));
    item.element.dataset.state = states.size === 1 ? [...states][0] : "mixed";
    item.element.title = item.group.jobs
      .map((job) => `${job.preset.name}: ${node.__apexJobsStatuses.get(job.id)?.detail || statusText(node.__apexJobsStatuses.get(job.id))}`)
      .join("\n");
  }
  if (node.__apexJobsSummaryEl) {
    const counts = statusSummary(node.__apexJobsState.jobs, node.__apexJobsStatuses);
    const text = Object.entries(counts).map(([state, count]) => `${count} ${statusText({ state })}`).join(" · ");
    node.__apexJobsSummaryEl.textContent = text || "No jobs";
    node.__apexJobsSummaryEl.title = text;
  }
}

function setJobStatus(node, jobId, state, detail = "") {
  if (!node?.__apexJobsStatuses) return;
  node.__apexJobsStatuses.set(jobId, { state, detail });
  refreshRuntimeUI(node);
}

function resetStatuses(node) {
  node.__apexJobsStatuses.clear();
  for (const job of node.__apexJobsState.jobs) node.__apexJobsStatuses.set(job.id, { state: "ready", detail: "Ready" });
  refreshRuntimeUI(node);
}

function installQueueObserver() {
  if (queueObserverInstalled) return;
  queueObserverInstalled = true;
  const original = api.queuePrompt;
  api.queuePrompt = async function queueApexObserved(number, prompt, ...args) {
    const context = runContextFromPrompt(prompt, NODE_CLASS);
    try {
      const result = await original.call(this, number, prompt, ...args);
      if (context) {
        const batch = batches.get(context.batch_id);
        if (batch?.node && batch.jobIds.has(context.job_id)) {
          if (result?.prompt_id) {
            promptJobs.set(result.prompt_id, { batchId: context.batch_id, jobId: context.job_id, node: batch.node });
            setJobStatus(batch.node, context.job_id, "queued", `Queued as ${result.prompt_id}`);
          } else if (result?.node_errors && Object.keys(result.node_errors).length) {
            setJobStatus(batch.node, context.job_id, "failed", "Prompt validation failed.");
          }
        }
      }
      return result;
    } catch (error) {
      if (context) {
        const batch = batches.get(context.batch_id);
        setJobStatus(batch?.node, context.job_id, "failed", error?.message || "Prompt submission failed.");
      }
      throw error;
    }
  };

  const updateFromExecution = (state, event) => {
    const promptId = event.detail?.prompt_id;
    const tracked = promptJobs.get(promptId);
    if (!tracked) return;
    const detail = state === "failed"
      ? event.detail?.exception_message || event.detail?.exception_type || "Execution failed."
      : state === "interrupted" ? "Execution interrupted." : statusText({ state });
    setJobStatus(tracked.node, tracked.jobId, state, detail);
    if (["completed", "failed", "interrupted"].includes(state)) promptJobs.delete(promptId);
  };
  api.addEventListener("execution_start", (event) => updateFromExecution("running", event));
  api.addEventListener("execution_success", (event) => updateFromExecution("completed", event));
  api.addEventListener("execution_error", (event) => updateFromExecution("failed", event));
  api.addEventListener("execution_interrupted", (event) => updateFromExecution("interrupted", event));
}

async function resolvePreparedJobs(prepared) {
  const identities = new Map();
  for (const item of prepared) {
    if (item.skip) continue;
    for (const row of allRows(item.result.state)) {
      if (!row.enabled || row.strength === 0) continue;
      const key = JSON.stringify([row.name, row.sha256, row.size]);
      if (!identities.has(key)) identities.set(key, { key, row, id: `identity-${identities.size}` });
    }
  }
  const byId = new Map([...identities.values()].map((item) => [item.id, item]));
  const resolved = new Map();
  const errors = new Map();
  const values = [...identities.values()];
  for (let offset = 0; offset < values.length; offset += 512) {
    const chunk = values.slice(offset, offset + 512);
    const response = await fetchJson("/apex_lora_loader/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: chunk.map(({ id, row }) => ({ id, name: row.name, sha256: row.sha256, size: row.size })),
        force: false,
      }),
    });
    for (const entry of response.entries || []) {
      const item = byId.get(entry.id);
      if (item) resolved.set(item.key, entry);
    }
    for (const entry of response.errors || []) {
      const item = byId.get(entry.id);
      if (item) errors.set(item.key, entry.error || "LoRA could not be resolved.");
    }
  }

  for (const item of prepared) {
    if (item.skip) continue;
    const failures = [];
    for (const row of allRows(item.result.state)) {
      if (!row.enabled || row.strength === 0) continue;
      const key = JSON.stringify([row.name, row.sha256, row.size]);
      if (errors.has(key) || !resolved.has(key)) {
        failures.push(`${row.name}: ${errors.get(key) || "LoRA could not be resolved."}`);
        continue;
      }
      const identity = resolved.get(key);
      row.name = identity.name;
      row.sha256 = identity.sha256;
      row.size = identity.size;
    }
    if (failures.length) item.skip = failures.join("\n");
    else item.serialized = serializeState(item.result.state);
  }
}

async function preflight(node, baseValue) {
  const prepared = node.__apexJobsState.jobs.map((job) => {
    const result = applySnapshotToLoaderState(baseValue, job.preset);
    const missing = result.missing.map((entry) => entry.name);
    return {
      job,
      result,
      serialized: result.serialized,
      skip: missing.length ? `Missing from the current loader stack: ${missing.join(", ")}` : "",
    };
  });
  await resolvePreparedJobs(prepared);
  return prepared;
}

function makeBatchId(node) {
  return `${node.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function queueJobs(node) {
  if (activeSubmission || app.processingQueue) {
    setMessage(node, "ComfyUI is already submitting prompts. Try again when submission finishes.", true);
    return;
  }
  const blocked = nodeCanSubmit(node);
  if (blocked) {
    setMessage(node, blocked, true);
    return;
  }
  const { target, stackWidget } = targetLoader(node);
  const runWidget = widget(node, RUN_WIDGET);
  const baseValue = stackWidget.value;
  resetStatuses(node);
  node.__apexJobsBusy = true;
  renderNode(node);
  setMessage(node, "Checking jobs…");

  let prepared;
  try {
    prepared = await preflight(node, baseValue);
  } catch (error) {
    node.__apexJobsBusy = false;
    renderNode(node);
    setMessage(node, error?.message || "Job preflight failed.", true);
    return;
  }
  for (const item of prepared) {
    if (item.skip) setJobStatus(node, item.job.id, "skipped", item.skip);
  }
  const valid = prepared.filter((item) => !item.skip);
  if (!valid.length) {
    node.__apexJobsBusy = false;
    renderNode(node);
    setMessage(node, "No valid jobs to queue.", true);
    return;
  }

  const batchId = makeBatchId(node);
  const submission = {
    node,
    target,
    stackWidget,
    runWidget,
    baseValue,
    batchId,
    valid,
  };
  submission.queueCursor = createQueueCursor({
    batchId,
    validJobs: valid,
    stackWidget,
    runWidget,
    baseValue,
    onSubmitting: (item) => setJobStatus(node, item.job.id, "submitting", "Submitting prompt…"),
  });
  activeSubmission = submission;
  batches.set(batchId, { node, jobIds: new Set(valid.map((item) => item.job.id)) });
  setMessage(node, `Submitting ${valid.length} job${valid.length === 1 ? "" : "s"}…`);
  try {
    await app.queuePrompt(0, valid.length);
  } finally {
    submission.queueCursor.restore();
    activeSubmission = null;
    batches.delete(batchId);
    node.__apexJobsBusy = false;
    for (const item of valid) {
      const state = node.__apexJobsStatuses.get(item.job.id)?.state;
      if (state === "ready" || state === "submitting") {
        setJobStatus(node, item.job.id, "not_submitted", "Prompt submission stopped before this job was queued.");
      }
    }
    renderNode(node);
    const skipped = prepared.length - valid.length;
    setMessage(node, `Submitted ${valid.length - [...node.__apexJobsStatuses.values()].filter((item) => item.state === "not_submitted").length} job${valid.length === 1 ? "" : "s"}${skipped ? `; skipped ${skipped}` : ""}.`);
  }
}

function installQueueCallbacks(node) {
  const runWidget = widget(node, RUN_WIDGET);
  if (!runWidget || runWidget.__apexJobsCallbacks) return;
  runWidget.__apexJobsCallbacks = true;
  const originalBefore = runWidget.beforeQueued;
  const originalAfter = runWidget.afterQueued;
  runWidget.beforeQueued = function beforeQueued() {
    originalBefore?.apply(this, arguments);
    const submission = activeSubmission;
    if (submission?.node !== node) return;
    submission.queueCursor.beforeQueued();
  };
  runWidget.afterQueued = function afterQueued() {
    originalAfter?.apply(this, arguments);
    const submission = activeSubmission;
    if (submission?.node !== node) return;
    submission.queueCursor.afterQueued();
  };
}

async function showPresetPicker(node, anchor) {
  const { panel, close } = createPopover(anchor);
  panel.classList.add("apex-jobs-preset-picker");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search active presets…";
  const list = document.createElement("div");
  list.className = "apex-jobs-preset-list";
  list.textContent = "Loading presets…";
  panel.append(search, list);
  try {
    const data = await fetchJson("/apex_lora_loader/presets", { cache: "no-store" });
    const presets = (data.presets || []).filter((preset) => (preset.type || "active") === "active");
    const draw = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const filtered = presets.filter((preset) => preset.name.toLocaleLowerCase().includes(query));
      list.replaceChildren();
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "apex-jobs-picker-empty";
        empty.textContent = presets.length ? "No matching active presets." : "No active-state presets saved.";
        list.appendChild(empty);
        return;
      }
      for (const preset of filtered) {
        const button = document.createElement("button");
        button.type = "button";
        const name = document.createElement("span");
        name.textContent = preset.name;
        const count = document.createElement("small");
        count.textContent = `${preset.entries?.length || 0} active LoRA${preset.entries?.length === 1 ? "" : "s"}`;
        button.append(name, count);
        button.addEventListener("click", () => {
          try {
            addPresetJob(node.__apexJobsState, preset);
            commit(node);
            setMessage(node, `Added “${preset.name}”.`);
            close();
          } catch (error) {
            setMessage(node, error.message, true);
          }
        });
        list.appendChild(button);
      }
    };
    search.addEventListener("input", draw);
    draw();
    search.focus();
  } catch (error) {
    list.textContent = error.message;
    list.classList.add("error");
  }
}

function installDrag(row, node, sourceIds, targetFirstId) {
  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    closePresetPreview();
    node.__apexJobsDragIds = sourceIds;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sourceIds.join(","));
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    node.__apexJobsDragIds = null;
    row.classList.remove("dragging");
    node.__apexJobsRoot?.querySelectorAll(".drop-before,.drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
  });
  row.addEventListener("dragover", (event) => {
    if (!node.__apexJobsDragIds) return;
    event.preventDefault();
    const after = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.classList.toggle("drop-before", !after);
    row.classList.toggle("drop-after", after);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const after = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
    if (moveJobsAround(node.__apexJobsState, node.__apexJobsDragIds || [], targetFirstId, after)) commit(node);
  });
}

function buildExpandedRow(node, job, index) {
  const row = document.createElement("div");
  row.className = "apex-jobs-row";
  const grip = document.createElement("span");
  grip.className = "apex-jobs-grip";
  grip.title = "Drag to reorder";
  grip.appendChild(icon("grip"));
  const order = document.createElement("span");
  order.className = "apex-jobs-order";
  order.textContent = String(index + 1).padStart(2, "0");
  const name = document.createElement("span");
  name.className = "apex-jobs-name";
  name.textContent = job.preset.name;
  const status = document.createElement("span");
  status.className = "apex-jobs-status";
  const duplicate = iconButton("copy", "Duplicate job");
  duplicate.addEventListener("click", () => { duplicateJob(node.__apexJobsState, job.id); commit(node); });
  const remove = iconButton("x", "Remove job", "danger");
  remove.addEventListener("click", () => { removeJob(node.__apexJobsState, job.id); node.__apexJobsStatuses.delete(job.id); commit(node); });
  row.append(grip, order, name, status, duplicate, remove);
  node.__apexJobsStatusEls.set(job.id, [status]);
  attachPresetPreview(row, job.preset);
  installDrag(row, node, [job.id], job.id);
  return row;
}

function buildGroupedRow(node, group, index) {
  const row = document.createElement("div");
  row.className = "apex-jobs-row apex-jobs-group-row";
  const grip = document.createElement("span");
  grip.className = "apex-jobs-grip";
  grip.appendChild(icon("grip"));
  const order = document.createElement("span");
  order.className = "apex-jobs-order";
  order.textContent = String(index + 1).padStart(2, "0");
  const name = document.createElement("span");
  name.className = "apex-jobs-name";
  name.textContent = group.preset.name;
  const count = document.createElement("input");
  count.type = "number";
  count.min = "1";
  count.max = "2048";
  count.step = "1";
  count.value = String(group.jobs.length);
  count.className = "apex-jobs-count";
  count.title = "Number of adjacent runs";
  count.addEventListener("change", () => { setGroupCount(node.__apexJobsState, group.jobs[0].id, count.value); commit(node); });
  const status = document.createElement("span");
  status.className = "apex-jobs-status apex-jobs-group-status";
  const duplicate = iconButton("copy", "Add one run to this group");
  duplicate.addEventListener("click", () => { setGroupCount(node.__apexJobsState, group.jobs[0].id, group.jobs.length + 1); commit(node); });
  const remove = iconButton("x", "Remove group", "danger");
  remove.addEventListener("click", () => {
    for (const job of group.jobs) { removeJob(node.__apexJobsState, job.id); node.__apexJobsStatuses.delete(job.id); }
    commit(node);
  });
  row.append(grip, order, name, count, status, duplicate, remove);
  node.__apexJobsGroupStatusEls.push({ group, element: status });
  attachPresetPreview(row, group.preset);
  installDrag(row, node, group.jobs.map((job) => job.id), group.jobs[0].id);
  return row;
}

function renderNode(node) {
  const root = node.__apexJobsRoot;
  if (!root || !node.__apexJobsState) return;
  closePresetPreview();
  root.replaceChildren();
  node.__apexJobsStatusEls = new Map();
  node.__apexJobsGroupStatusEls = [];

  const toolbar = document.createElement("div");
  toolbar.className = "apex-jobs-toolbar";
  const connection = document.createElement("div");
  connection.className = "apex-jobs-connection";
  const target = targetLoader(node);
  connection.classList.toggle("connected", !target.error);
  connection.title = target.error
    || `Connected to “${target.target.title || "Apex LoRA Loader"}” (node ${target.target.id}). Preset jobs will target this loader.`;
  connection.setAttribute("role", "status");
  connection.setAttribute("aria-label", target.error || `Connected to ${target.target.title || "Apex LoRA Loader"}, node ${target.target.id}`);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "apex-jobs-add";
  const addLabel = document.createElement("span");
  addLabel.className = "apex-jobs-add-label";
  addLabel.textContent = "Add preset";
  add.append(icon("plus"), addLabel);
  add.disabled = node.__apexJobsBusy;
  add.addEventListener("click", () => showPresetPicker(node, add));
  const view = iconButton(
    node.__apexJobsState.view === "grouped" ? "listChevronsUpDown" : "listChevronsDownUp",
    node.__apexJobsState.view === "grouped" ? "Show individual jobs" : "Group adjacent identical jobs",
  );
  view.disabled = node.__apexJobsBusy;
  view.addEventListener("click", () => { node.__apexJobsState.view = node.__apexJobsState.view === "grouped" ? "expanded" : "grouped"; commit(node); });
  const clear = iconButton("trash", "Clear all jobs", "danger");
  clear.disabled = node.__apexJobsBusy || !node.__apexJobsState.jobs.length;
  clear.addEventListener("click", () => {
    if (!node.__apexJobsState.jobs.length || !window.confirm(`Remove all ${node.__apexJobsState.jobs.length} preset jobs?`)) return;
    node.__apexJobsState.jobs = [];
    node.__apexJobsStatuses.clear();
    commit(node);
  });
  const queue = document.createElement("button");
  queue.type = "button";
  queue.className = "apex-jobs-queue";
  queue.appendChild(icon("play"));
  queue.disabled = node.__apexJobsBusy || Boolean(nodeCanSubmit(node));
  queue.title = nodeCanSubmit(node) || "Queue every valid preset job";
  queue.setAttribute("aria-label", node.__apexJobsBusy ? "Submitting preset jobs" : "Queue preset jobs");
  queue.addEventListener("click", () => queueJobs(node));

  const message = document.createElement("div");
  message.className = `apex-jobs-message${node.__apexJobsMessage?.error ? " error" : ""}`;
  message.textContent = node.__apexJobsMessage?.message || "";
  message.title = message.textContent;
  node.__apexJobsMessageEl = message;
  const statusIsland = document.createElement("div");
  statusIsland.className = `apex-jobs-status-island${node.__apexJobsMessage?.error ? " error" : ""}`;
  statusIsland.append(connection, message);
  node.__apexJobsStatusIslandEl = statusIsland;
  toolbar.append(add, statusIsland, view, clear, queue);

  const list = document.createElement("div");
  list.className = "apex-jobs-list";
  list.addEventListener("scroll", closePresetPreview, { passive: true });
  list.addEventListener("dragover", (event) => {
    if (!node.__apexJobsDragIds) return;
    const rect = list.getBoundingClientRect();
    if (event.clientY < rect.top + 28) list.scrollTop -= 12;
    else if (event.clientY > rect.bottom - 28) list.scrollTop += 12;
  });
  if (!node.__apexJobsState.jobs.length) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "apex-jobs-empty";
    empty.append(icon("plus"), document.createTextNode("Add an active-state preset to begin"));
    empty.addEventListener("click", () => showPresetPicker(node, empty));
    list.appendChild(empty);
  } else if (node.__apexJobsState.view === "grouped") {
    groupAdjacentJobs(node.__apexJobsState.jobs).forEach((group, index) => list.appendChild(buildGroupedRow(node, group, index)));
  } else {
    node.__apexJobsState.jobs.forEach((job, index) => list.appendChild(buildExpandedRow(node, job, index)));
  }

  const footer = document.createElement("div");
  footer.className = "apex-jobs-footer";
  const count = document.createElement("span");
  count.textContent = `${node.__apexJobsState.jobs.length} run${node.__apexJobsState.jobs.length === 1 ? "" : "s"}`;
  const summary = document.createElement("span");
  summary.className = "apex-jobs-summary";
  node.__apexJobsSummaryEl = summary;
  footer.append(count, summary);
  root.append(toolbar, list, footer);
  refreshRuntimeUI(node);
}

function buildNodeUI(node) {
  if (node.__apexJobsBuilt) return;
  node.__apexJobsBuilt = true;
  injectStyles();
  installQueueObserver();
  if (node.color == null) node.color = "#181c23";
  if (node.bgcolor == null) node.bgcolor = "#111923";
  const data = widget(node, JOBS_WIDGET);
  const run = widget(node, RUN_WIDGET);
  hideWidget(data);
  hideWidget(run);
  if (run) run.value = IDLE_RUN_CONTEXT;
  node.__apexJobsState = normalizeJobsState(data?.value || createJobsState());
  if (data) data.value = serializeJobsState(node.__apexJobsState);
  node.__apexJobsStatuses = new Map();
  node.__apexJobsMessage = { message: "", error: false };
  resetStatuses(node);

  const root = document.createElement("div");
  root.className = "apex-jobs-root";
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  const domWidget = node.addDOMWidget("apex_preset_jobs_ui", "apex-preset-jobs-ui", root, {
    serialize: false,
    margin: 3,
    getMinHeight: () => 180,
  });
  domWidget.computeLayoutSize = () => ({ minHeight: 180, maxHeight: undefined, minWidth: 0 });
  domWidget.serializeValue = () => undefined;
  node.__apexJobsRoot = root;
  node.__apexJobsDomWidget = domWidget;
  node.size = [Math.max(node.size?.[0] || 0, DEFAULT_SIZE[0]), Math.max(node.size?.[1] || 0, DEFAULT_SIZE[1])];
  installQueueCallbacks(node);
  renderNode(node);
}

app.registerExtension({
  name: "apex.ApexPresetJobs",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function onNodeCreated() {
      const result = originalCreated?.apply(this, arguments);
      buildNodeUI(this);
      return result;
    };
    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function onConfigure() {
      const result = originalConfigure?.apply(this, arguments);
      if (!this.__apexJobsBuilt) buildNodeUI(this);
      hideWidget(widget(this, JOBS_WIDGET));
      hideWidget(widget(this, RUN_WIDGET));
      const run = widget(this, RUN_WIDGET);
      if (run) run.value = IDLE_RUN_CONTEXT;
      this.__apexJobsState = normalizeJobsState(widget(this, JOBS_WIDGET)?.value);
      const data = widget(this, JOBS_WIDGET);
      if (data) data.value = serializeJobsState(this.__apexJobsState);
      resetStatuses(this);
      renderNode(this);
      return result;
    };
    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function onConnectionsChange() {
      const result = originalConnections?.apply(this, arguments);
      queueMicrotask(() => { if (this.__apexJobsBuilt) renderNode(this); });
      return result;
    };
    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function onRemoved() {
      if (activeSubmission?.node === this) {
        activeSubmission.queueCursor.restore();
        batches.delete(activeSubmission.batchId);
        activeSubmission = null;
      }
      closePopover();
      closePresetPreview();
      this.__apexJobsRoot?.replaceChildren();
      this.__apexJobsBuilt = false;
      return originalRemoved?.apply(this, arguments);
    };
  },
});
