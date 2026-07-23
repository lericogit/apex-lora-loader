import test from "node:test";
import assert from "node:assert/strict";

import { activeLoraSignature, createAutoQueueController } from "../web/auto_queue.js";


function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    get count() {
      return timers.size;
    },
    get nextDelay() {
      return timers.values().next().value?.delay;
    },
    async runNext() {
      const entry = timers.entries().next().value;
      if (!entry) return undefined;
      const [id, timer] = entry;
      timers.delete(id);
      return await timer.callback();
    },
  };
}


function stateWithRows(rows) {
  return {
    sections: [{ id: "section", loras: rows }],
  };
}


test("active LoRA signatures include execution order and normalized active strengths only", () => {
  const state = stateWithRows([
    { id: "one", name: "a.safetensors", enabled: true, strength: 1.234 },
    { id: "two", name: "b.safetensors", enabled: false, strength: 8 },
    { id: "three", name: "c.safetensors", enabled: true, strength: -0.505 },
  ]);
  assert.equal(
    activeLoraSignature(state),
    JSON.stringify([
      ["one", "a.safetensors", 1.23],
      ["three", "c.safetensors", -0.5],
    ]),
  );
  state.sections[0].loras[1].strength = 99;
  assert.equal(
    activeLoraSignature(state),
    JSON.stringify([
      ["one", "a.safetensors", 1.23],
      ["three", "c.safetensors", -0.5],
    ]),
  );
});


test("auto queue debounces changes and submits only the newest settled state", async () => {
  const timers = fakeTimers();
  const state = stateWithRows([{ id: "one", name: "a", enabled: false, strength: 1 }]);
  let submissions = 0;
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(state),
    submit: async () => { submissions += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  state.sections[0].loras[0].enabled = true;
  controller.notifyChange();
  state.sections[0].loras[0].strength = 1.5;
  controller.notifyChange();
  assert.equal(timers.count, 1);
  await timers.runNext();
  assert.equal(submissions, 1);
  assert.equal(controller.state.phase, "queued");
  assert.equal(controller.state.inFlight, false);
});


test("returning to the armed state cancels a pending automatic run", () => {
  const timers = fakeTimers();
  const row = { id: "one", name: "a", enabled: false, strength: 1 };
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(stateWithRows([row])),
    submit: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  row.enabled = true;
  controller.notifyChange();
  assert.equal(timers.count, 1);
  row.enabled = false;
  assert.equal(controller.notifyChange(), false);
  assert.equal(timers.count, 0);
  assert.equal(controller.state.phase, "armed");
});


test("auto queue reads the current configured delay for every settled change", () => {
  const timers = fakeTimers();
  const row = { id: "one", name: "a", enabled: false, strength: 1 };
  let delayMs = 250;
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(stateWithRows([row])),
    getDelayMs: () => delayMs,
    submit: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  row.enabled = true;
  controller.notifyChange();
  assert.equal(timers.nextDelay, 250);
  controller.acknowledgeCurrent();
  delayMs = 725;
  row.enabled = false;
  controller.notifyChange();
  assert.equal(timers.nextDelay, 725);
});


test("blocked submissions wait and resume through a fresh debounce", async () => {
  const timers = fakeTimers();
  const row = { id: "one", name: "a", enabled: false, strength: 1 };
  let blocked = true;
  let submissions = 0;
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(stateWithRows([row])),
    submit: async () => { submissions += 1; },
    isBlocked: () => blocked,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  row.enabled = true;
  controller.notifyChange();
  await timers.runNext();
  assert.equal(submissions, 0);
  assert.equal(controller.state.phase, "waiting");
  blocked = false;
  assert.equal(controller.resume(), true);
  assert.equal(timers.count, 1);
  await timers.runNext();
  assert.equal(submissions, 1);
});


test("a newer change during submission is coalesced into one follow-up run", async () => {
  const timers = fakeTimers();
  const row = { id: "one", name: "a", enabled: true, strength: 1 };
  let releaseFirst;
  let submissions = 0;
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(stateWithRows([row])),
    submit: async () => {
      submissions += 1;
      if (submissions === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  row.strength = 1.1;
  controller.notifyChange();
  const firstRun = timers.runNext();
  await Promise.resolve();
  assert.equal(controller.state.inFlight, true);

  row.strength = 1.2;
  controller.notifyChange();
  await timers.runNext();
  assert.equal(controller.state.phase, "waiting");
  releaseFirst();
  await firstRun;
  assert.equal(timers.count, 1);
  await timers.runNext();
  assert.equal(submissions, 2);
});


test("manual acknowledgement and disposal cancel pending runs", () => {
  const timers = fakeTimers();
  const row = { id: "one", name: "a", enabled: false, strength: 1 };
  const controller = createAutoQueueController({
    getSignature: () => activeLoraSignature(stateWithRows([row])),
    submit: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.setEnabled(true);
  row.enabled = true;
  controller.notifyChange();
  controller.acknowledgeCurrent();
  assert.equal(timers.count, 0);
  row.enabled = false;
  controller.notifyChange();
  assert.equal(timers.count, 1);
  controller.dispose();
  assert.equal(timers.count, 0);
  assert.equal(controller.state.disposed, true);
});
