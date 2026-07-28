import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFolderTree,
  defaultExpandedFolders,
  expandedFoldersFromView,
  folderDirectSelected,
  folderTreeSelectionStates,
  matchesFolderRules,
  MAX_FOLDER_TREE_VIEW_PATHS,
  normalizeFolderTreeView,
  normalizeNodeFolderFilters,
  reconcileFolderTreeView,
  setFolderDirectSelected,
  setFolderSubtreeSelected,
  setFolderTreeExpanded,
  visibleFolderTreeRows,
} from "../web/folder_tree.js";


test("folder tree groups descendants, direct files, and recursive counts", () => {
  const tree = buildFolderTree([
    "root.safetensors",
    "characters/base.safetensors",
    "characters/humans/a.safetensors",
    "characters/humans/deep/b.safetensors",
    "styles/c.safetensors",
  ]);

  assert.equal(tree.directCount, 1);
  assert.equal(tree.totalCount, 5);
  assert.deepEqual(tree.children.map((node) => [node.path, node.totalCount]), [
    ["characters", 3],
    ["styles", 1],
  ]);
  assert.deepEqual(
    tree.children[0].children.map((node) => [node.path, node.totalCount]),
    [["characters/humans", 2]],
  );
});


test("default compact view expands root folders but keeps deeper branches collapsed", () => {
  const tree = buildFolderTree([
    "root.safetensors",
    "characters/base.safetensors",
    "characters/humans/a.safetensors",
    "characters/humans/deep/b.safetensors",
  ]);
  const rows = visibleFolderTreeRows(tree, defaultExpandedFolders(tree));

  assert.deepEqual(rows.map((row) => [row.type, row.node.path, row.depth]), [
    ["folder", "", 0],
    ["direct", "", 1],
    ["folder", "characters", 1],
    ["direct", "characters", 2],
    ["folder", "characters/humans", 2],
  ]);
});


test("direct-file overrides do not weaken recursive future-folder selection", () => {
  let rules = normalizeNodeFolderFilters(["characters"]);
  assert.equal(matchesFolderRules("characters/base.safetensors", rules), true);
  assert.equal(matchesFolderRules("characters/future/new.safetensors", rules), true);

  rules = setFolderDirectSelected(rules, "characters", false);
  assert.equal(folderDirectSelected("characters", rules), false);
  assert.equal(matchesFolderRules("characters/base.safetensors", rules), false);
  assert.equal(matchesFolderRules("characters/future/new.safetensors", rules), true);

  rules = setFolderSubtreeSelected(rules, "characters", false);
  assert.equal(matchesFolderRules("characters/future/new.safetensors", rules), false);
});


test("legacy root-only filters remain root-only", () => {
  const rules = normalizeNodeFolderFilters([""]);
  assert.equal(matchesFolderRules("root.safetensors", rules), true);
  assert.equal(matchesFolderRules("nested/no.safetensors", rules), false);
});


test("parent checkbox state aggregates direct files and descendants", () => {
  const tree = buildFolderTree([
    "characters/base.safetensors",
    "characters/humans/a.safetensors",
  ]);
  let rules = normalizeNodeFolderFilters(["characters"]);
  assert.deepEqual(folderTreeSelectionStates(tree, rules).get("characters"), {
    checked: true,
    mixed: false,
  });

  rules = setFolderDirectSelected(rules, "characters", false);
  assert.deepEqual(folderTreeSelectionStates(tree, rules).get("characters"), {
    checked: false,
    mixed: true,
  });
});


test("folder expansion overrides persist relative to safe defaults", () => {
  const tree = buildFolderTree([
    "characters/base.safetensors",
    "characters/humans/a.safetensors",
    "characters/humans/deep/b.safetensors",
    "styles/c.safetensors",
  ]);
  let view = normalizeFolderTreeView();
  view = setFolderTreeExpanded(view, "characters", false);
  view = setFolderTreeExpanded(view, "characters/humans", true);

  assert.deepEqual(view, {
    expanded: ["characters/humans"],
    collapsed: ["characters"],
  });
  assert.deepEqual([...expandedFoldersFromView(tree, view)].sort(), [
    "",
    "characters/humans",
    "styles",
  ]);
});


test("new folders use defaults while missing and non-expandable paths are pruned", () => {
  const tree = buildFolderTree([
    "new-top/child/a.safetensors",
    "single/b.safetensors",
  ]);
  const reconciled = reconcileFolderTreeView({
    expanded: ["removed/deep", "single"],
    collapsed: ["new-top", "removed"],
  }, tree);

  assert.deepEqual(reconciled, {
    expanded: [],
    collapsed: ["new-top"],
  });
  assert.equal(expandedFoldersFromView(tree, reconciled).has("new-top"), false);
  assert.equal(expandedFoldersFromView(tree, reconciled).has("single"), true);
});


test("folder view normalization is bounded, canonical, and conflict-safe", () => {
  const values = Array.from(
    { length: MAX_FOLDER_TREE_VIEW_PATHS + 20 },
    (_, index) => `folder/${index}`,
  );
  const normalized = normalizeFolderTreeView({
    expanded: [...values, "folder\\latest", "../unsafe"],
    collapsed: ["folder/latest", "folder/other", 4],
  });

  assert.equal(normalized.expanded.length, MAX_FOLDER_TREE_VIEW_PATHS);
  assert.equal(normalized.expanded.includes("folder/latest"), true);
  assert.equal(normalized.collapsed.includes("folder/latest"), false);
  assert.deepEqual(normalized.collapsed, ["folder/other"]);
});
