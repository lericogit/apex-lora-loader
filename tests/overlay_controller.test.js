import test from "node:test";
import assert from "node:assert/strict";

import { createSingleOwnerController } from "../web/overlay_controller.js";


test("overlay controller owns one node and switches deterministically", () => {
  const events = [];
  const controller = createSingleOwnerController({
    mount: (node) => events.push(`mount:${node.name}`),
    render: (node) => events.push(`render:${node.name}`),
    unmount: (node) => events.push(`unmount:${node.name}`),
  });
  const first = { name: "first" };
  const second = { name: "second" };

  assert.equal(controller.open(first), true);
  assert.equal(controller.open(first), true);
  assert.equal(controller.open(second), true);
  assert.equal(controller.owner, second);
  assert.deepEqual(events, [
    "mount:first",
    "render:first",
    "render:first",
    "unmount:first",
    "mount:second",
    "render:second",
  ]);
});


test("overlay controller ignores unrelated refreshes and removals", () => {
  const events = [];
  const controller = createSingleOwnerController({
    mount: (node) => events.push(`mount:${node.id}`),
    render: (node) => events.push(`render:${node.id}`),
    unmount: (node) => events.push(`unmount:${node.id}`),
  });
  const owner = { id: 7 };
  const unrelated = { id: 7 };

  controller.open(owner);
  assert.equal(controller.refresh(unrelated), false);
  assert.equal(controller.nodeRemoved(unrelated), false);
  assert.equal(controller.owner, owner);
  assert.equal(controller.nodeRemoved(owner), true);
  assert.equal(controller.owner, null);
  assert.deepEqual(events, ["mount:7", "render:7", "unmount:7"]);
});


test("overlay controller dispose is idempotent and prevents reopening", () => {
  let unmounts = 0;
  const node = {};
  const controller = createSingleOwnerController({
    unmount: () => { unmounts += 1; },
  });

  controller.open(node);
  controller.dispose();
  controller.dispose();
  assert.equal(unmounts, 1);
  assert.equal(controller.disposed, true);
  assert.equal(controller.open(node), false);
});


test("overlay controller close honors the expected owner", () => {
  let unmounts = 0;
  const owner = {};
  const unrelated = {};
  const controller = createSingleOwnerController({
    unmount: () => { unmounts += 1; },
  });

  controller.open(owner);
  assert.equal(controller.close(unrelated), false);
  assert.equal(controller.owner, owner);
  assert.equal(controller.close(owner), true);
  assert.equal(controller.close(), false);
  assert.equal(unmounts, 1);
});


test("overlay controller rolls back ownership after a failed mount", () => {
  let unmounts = 0;
  const controller = createSingleOwnerController({
    mount: () => { throw new Error("mount failed"); },
    unmount: () => { unmounts += 1; },
  });

  assert.throws(() => controller.open({}), /mount failed/);
  assert.equal(controller.owner, null);
  assert.equal(unmounts, 1);
});
