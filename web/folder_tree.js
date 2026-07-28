function canonicalFolder(value) {
  if (typeof value !== "string") return null;
  const parts = [];
  for (const rawPart of value.trim().replaceAll("\\", "/").split("/")) {
    const part = rawPart.trim();
    if (!part || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.join("/");
}


function comparePaths(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  }) || (left < right ? -1 : left > right ? 1 : 0);
}


function canonicalFolders(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(canonicalFolder)
      .filter((value) => value !== null),
  )].sort(comparePaths);
}


function pathIsWithin(path, parent) {
  return parent === "" || path === parent || path.startsWith(`${parent}/`);
}


export const MAX_FOLDER_TREE_VIEW_PATHS = 256;


function canonicalViewPaths(values) {
  const unique = new Set();
  const paths = [];
  const source = Array.isArray(values) ? values : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const folder = canonicalFolder(source[index]);
    if (folder === null || unique.has(folder)) continue;
    unique.add(folder);
    paths.push(folder);
    if (paths.length === MAX_FOLDER_TREE_VIEW_PATHS) break;
  }
  return paths.sort(comparePaths);
}


export function normalizeFolderTreeView(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const expanded = canonicalViewPaths(source.expanded);
  const expandedSet = new Set(expanded);
  return {
    expanded,
    collapsed: canonicalViewPaths(source.collapsed)
      .filter((folder) => !expandedSet.has(folder)),
  };
}


function folderDefaultExpanded(folder) {
  return folder === "" || !folder.includes("/");
}


export function setFolderTreeExpanded(value, folder, expanded) {
  const canonical = canonicalFolder(folder);
  const next = normalizeFolderTreeView(value);
  if (canonical === null) return next;
  next.expanded = next.expanded.filter((path) => path !== canonical);
  next.collapsed = next.collapsed.filter((path) => path !== canonical);
  if (expanded !== folderDefaultExpanded(canonical)) {
    (expanded ? next.expanded : next.collapsed).push(canonical);
  }
  return normalizeFolderTreeView(next);
}


export function normalizeFolderRules(value, defaultSelected = false) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const includeFolders = canonicalFolders(source.include_folders);
  const includedFolders = new Set(includeFolders);
  const includeDirect = canonicalFolders(source.include_direct);
  const includedDirect = new Set(includeDirect);
  return {
    default_selected: source.default_selected === true || (
      source.default_selected === undefined && defaultSelected === true
    ),
    include_folders: includeFolders,
    exclude_folders: canonicalFolders(source.exclude_folders)
      .filter((folder) => !includedFolders.has(folder)),
    include_direct: includeDirect,
    exclude_direct: canonicalFolders(source.exclude_direct)
      .filter((folder) => !includedDirect.has(folder)),
  };
}


export function normalizeNodeFolderFilters(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return normalizeFolderRules({
      default_selected: false,
      include_folders: value.filter((folder) => folder !== ""),
      include_direct: value.includes("") ? [""] : [],
    });
  }
  if (typeof value !== "object") return null;
  return normalizeFolderRules(value);
}


function createNormalizedRuleMatcher(normalized) {
  const included = new Set(normalized.include_folders);
  const excluded = new Set(normalized.exclude_folders);
  const directIncluded = new Set(normalized.include_direct);
  const directExcluded = new Set(normalized.exclude_direct);
  const subtree = (folder) => {
    const normalizedFolder = canonicalFolder(folder);
    if (normalizedFolder === null) return false;
    let selected = normalized.default_selected;
    if (included.has("")) selected = true;
    else if (excluded.has("")) selected = false;
    if (!normalizedFolder) return selected;
    let path = "";
    for (const part of normalizedFolder.split("/")) {
      path = path ? `${path}/${part}` : part;
      if (included.has(path)) selected = true;
      else if (excluded.has(path)) selected = false;
    }
    return selected;
  };
  return {
    subtree,
    direct: (folder) => {
      const normalizedFolder = canonicalFolder(folder);
      if (normalizedFolder === null) return false;
      if (directIncluded.has(normalizedFolder)) return true;
      if (directExcluded.has(normalizedFolder)) return false;
      return subtree(normalizedFolder);
    },
  };
}


export function folderSubtreeSelected(folder, rules) {
  return createNormalizedRuleMatcher(normalizeFolderRules(rules)).subtree(folder);
}


export function folderDirectSelected(folder, rules) {
  return createNormalizedRuleMatcher(normalizeFolderRules(rules)).direct(folder);
}


export function setFolderSubtreeSelected(rules, folder, selected) {
  const normalizedFolder = canonicalFolder(folder);
  const next = normalizeFolderRules(rules);
  if (normalizedFolder === null) return next;
  for (const key of [
    "include_folders",
    "exclude_folders",
    "include_direct",
    "exclude_direct",
  ]) {
    next[key] = next[key].filter((value) => !pathIsWithin(value, normalizedFolder));
  }
  (selected ? next.include_folders : next.exclude_folders).push(normalizedFolder);
  return normalizeFolderRules(next);
}


export function setFolderDirectSelected(rules, folder, selected) {
  const normalizedFolder = canonicalFolder(folder);
  const next = normalizeFolderRules(rules);
  if (normalizedFolder === null) return next;
  next.include_direct = next.include_direct.filter((value) => value !== normalizedFolder);
  next.exclude_direct = next.exclude_direct.filter((value) => value !== normalizedFolder);
  if (folderSubtreeSelected(normalizedFolder, next) !== selected) {
    (selected ? next.include_direct : next.exclude_direct).push(normalizedFolder);
  }
  return normalizeFolderRules(next);
}


export function matchesFolderRules(name, rules) {
  const normalizedName = String(name ?? "").replaceAll("\\", "/");
  const separator = normalizedName.lastIndexOf("/");
  const folder = separator === -1 ? "" : normalizedName.slice(0, separator);
  return folderDirectSelected(folder, rules);
}


export function createFolderRuleMatcher(rules) {
  return createNormalizedRuleMatcher(normalizeFolderRules(rules));
}


function ensureFolder(root, byPath, folder) {
  if (byPath.has(folder)) return byPath.get(folder);
  const separator = folder.lastIndexOf("/");
  const parentPath = separator === -1 ? "" : folder.slice(0, separator);
  const parent = ensureFolder(root, byPath, parentPath);
  const node = {
    path: folder,
    name: separator === -1 ? folder : folder.slice(separator + 1),
    directCount: 0,
    totalCount: 0,
    children: [],
  };
  byPath.set(folder, node);
  parent.children.push(node);
  return node;
}


export function buildFolderTree(names, extraFolders = []) {
  const root = {
    path: "",
    name: "(root)",
    directCount: 0,
    totalCount: 0,
    children: [],
  };
  const byPath = new Map([["", root]]);
  for (const folder of canonicalFolders(extraFolders)) ensureFolder(root, byPath, folder);
  for (const rawName of Array.isArray(names) ? names : []) {
    const name = String(rawName ?? "").replaceAll("\\", "/");
    if (!name) continue;
    const separator = name.lastIndexOf("/");
    const folder = separator === -1 ? "" : canonicalFolder(name.slice(0, separator));
    if (folder === null) continue;
    ensureFolder(root, byPath, folder).directCount += 1;
  }
  const finish = (node) => {
    node.children.sort((left, right) => comparePaths(left.name, right.name));
    node.totalCount = node.directCount
      + node.children.reduce((total, child) => total + finish(child), 0);
    return node.totalCount;
  };
  finish(root);
  return root;
}


export function defaultExpandedFolders(tree) {
  const expanded = new Set([""]);
  for (const child of tree?.children || []) expanded.add(child.path);
  return expanded;
}


function expandableFolderPaths(tree) {
  const paths = new Set();
  const visit = (node) => {
    if (node.children.length) paths.add(node.path);
    for (const child of node.children) visit(child);
  };
  if (tree) visit(tree);
  return paths;
}


export function reconcileFolderTreeView(value, tree) {
  const normalized = normalizeFolderTreeView(value);
  const valid = expandableFolderPaths(tree);
  return {
    expanded: normalized.expanded.filter((path) => valid.has(path)),
    collapsed: normalized.collapsed.filter((path) => valid.has(path)),
  };
}


export function expandedFoldersFromView(tree, value) {
  const reconciled = reconcileFolderTreeView(value, tree);
  const expanded = defaultExpandedFolders(tree);
  for (const folder of reconciled.collapsed) expanded.delete(folder);
  for (const folder of reconciled.expanded) expanded.add(folder);
  return expanded;
}


export function folderNodeSelectionState(node, rules) {
  return folderTreeSelectionStates(node, rules).get(node.path);
}


export function folderTreeSelectionStates(tree, rules) {
  const matcher = createFolderRuleMatcher(rules);
  const states = new Map();
  const visit = (node) => {
    const values = [];
    if (node.directCount > 0) values.push(matcher.direct(node.path));
    for (const child of node.children) {
      const state = visit(child);
      if (state.mixed) values.push(true, false);
      else values.push(state.checked);
    }
    let state;
    if (!values.length) {
      state = { checked: matcher.subtree(node.path), mixed: false };
    } else {
      const selected = values.filter(Boolean).length;
      state = {
        checked: selected === values.length,
        mixed: selected > 0 && selected < values.length,
      };
    }
    states.set(node.path, state);
    return state;
  };
  visit(tree);
  return states;
}


export function visibleFolderTreeRows(tree, expandedFolders) {
  const expanded = expandedFolders instanceof Set ? expandedFolders : new Set();
  const rows = [];
  const visit = (node, depth) => {
    rows.push({ type: "folder", node, depth });
    if (!expanded.has(node.path) || !node.children.length) return;
    if (node.directCount > 0) {
      rows.push({ type: "direct", node, depth: depth + 1 });
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(tree, 0);
  return rows;
}
