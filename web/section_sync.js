export const DEFAULT_SECTION_SYNC = Object.freeze({
  enabled: false,
  auto_sync: false,
  mode: "mirror",
  include_folders: Object.freeze([]),
  exclude_folders: Object.freeze([]),
  seen_names: Object.freeze([]),
  ignored: Object.freeze([]),
});


function canonicalPath(value, allowEmpty) {
  if (typeof value !== "string") return null;
  const parts = [];
  for (const rawPart of value.trim().replaceAll("\\", "/").split("/")) {
    const part = rawPart.trim();
    if (!part || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  const result = parts.join("/");
  return result || (allowEmpty ? "" : null);
}


function comparePaths(left, right) {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}


function canonicalList(values, allowEmpty) {
  const unique = new Set();
  const result = [];
  let ordered = true;
  let previous = null;
  for (const value of Array.isArray(values) ? values : []) {
    const canonical = canonicalPath(value, allowEmpty);
    if (canonical === null || unique.has(canonical)) continue;
    if (previous !== null && comparePaths(previous, canonical) > 0) ordered = false;
    unique.add(canonical);
    result.push(canonical);
    previous = canonical;
  }
  return ordered ? result : result.sort(comparePaths);
}


function normalizedHash(value) {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
}


function normalizedSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? Math.trunc(size) : 0;
}


function normalizedIdentity(value) {
  const name = canonicalPath(value?.name, false);
  if (!name) return null;
  return {
    name,
    sha256: normalizedHash(value?.sha256),
    size: normalizedSize(value?.size),
  };
}


function normalizeIgnored(values) {
  const byName = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const identity = normalizedIdentity(value);
    if (!identity) continue;
    byName.set(identity.name, identity);
  }
  return [...byName.values()].sort((left, right) => comparePaths(left.name, right.name));
}


function folderOf(name) {
  const separator = name.lastIndexOf("/");
  return separator === -1 ? "" : name.slice(0, separator);
}


function namesFrom(values) {
  return canonicalList(
    (Array.isArray(values) ? values : []).map((value) => (
      typeof value === "string" ? value : value?.name
    )),
    false,
  );
}


export function canonicalRelativePath(value) {
  return canonicalPath(value, false) ?? "";
}


export function canonicalFolderPath(value) {
  return canonicalPath(value, true) ?? "";
}


export function normalizeSectionSyncIdentity(value) {
  return normalizedIdentity(value);
}


export function normalizeSectionSync(value) {
  const source = value && typeof value === "object" ? value : {};
  const includeFolders = canonicalList(source.include_folders, true);
  const included = new Set(includeFolders);
  return {
    enabled: source.enabled === true,
    auto_sync: source.auto_sync === true,
    mode: source.mode === "new" ? "new" : "mirror",
    include_folders: includeFolders,
    exclude_folders: canonicalList(source.exclude_folders, true)
      .filter((folder) => !included.has(folder)),
    seen_names: canonicalList(source.seen_names, false),
    ignored: normalizeIgnored(source.ignored),
  };
}


function folderRuleMatcher(normalized) {
  const included = new Set(normalized.include_folders);
  const excluded = new Set(normalized.exclude_folders);
  return (folder) => {
    let selected = included.has("");
    if (!folder) return selected;
    let path = "";
    for (const part of folder.split("/")) {
      path = path ? `${path}/${part}` : part;
      if (included.has(path)) selected = true;
      else if (excluded.has(path)) selected = false;
    }
    return selected;
  };
}


function normalizedNodeFilters(folderFilters) {
  if (folderFilters === null || folderFilters === undefined) return null;
  return new Set(canonicalList(folderFilters, true));
}


function nodeFilterMatcher(filters) {
  if (filters === null) return () => true;
  if (!filters.size) return () => false;
  return (folder) => {
    if (!folder) return filters.has("");
    let path = "";
    for (const part of folder.split("/")) {
      path = path ? `${path}/${part}` : part;
      if (filters.has(path)) return true;
    }
    return false;
  };
}


function eligibleNamesWithNormalizedConfig(catalogNames, normalized, folderFilters) {
  const matchesRules = folderRuleMatcher(normalized);
  const matchesFilters = nodeFilterMatcher(normalizedNodeFilters(folderFilters));
  return namesFrom(catalogNames).filter((name) => {
    const folder = folderOf(name);
    return matchesRules(folder) && matchesFilters(folder);
  });
}


function actionableNamesFromEligible(eligible, existingNames, normalized) {
  if (!normalized.enabled) return [];
  const existing = new Set(namesFrom(existingNames));
  const ignoredNames = new Set(normalized.ignored.map((identity) => identity.name));
  const seen = new Set(normalized.seen_names);
  return eligible.filter((name) => (
    !existing.has(name)
    && !ignoredNames.has(name)
    && (normalized.mode !== "new" || !seen.has(name))
  ));
}


export function matchesSectionSyncFolders(name, config) {
  const canonicalName = canonicalPath(name, false);
  if (!canonicalName) return false;
  const normalized = normalizeSectionSync(config);
  return folderRuleMatcher(normalized)(folderOf(canonicalName));
}


export function sectionSyncFolderSelectionStates(folders, config) {
  const normalized = normalizeSectionSync(config);
  const matchesRules = folderRuleMatcher(normalized);
  const states = new Map();
  for (const folder of canonicalList(folders, true)) {
    states.set(folder, matchesRules(folder));
  }
  return states;
}


export function sectionSyncFolderTree(folders) {
  const ordered = canonicalList(folders, true);
  const visible = new Set(ordered);
  return ordered.map((folder) => {
    let depth = 0;
    if (folder) {
      let ancestor = folderOf(folder);
      while (true) {
        if (visible.has(ancestor)) depth += 1;
        if (!ancestor) break;
        ancestor = folderOf(ancestor);
      }
    }
    return { folder, depth };
  });
}


export function isSectionSyncFolderSelected(folder, config) {
  const canonicalFolder = canonicalPath(folder, true);
  if (canonicalFolder === null) return false;
  const normalized = normalizeSectionSync(config);
  return folderRuleMatcher(normalized)(canonicalFolder);
}


export function setSectionSyncFolderSelected(config, folder, selected) {
  const normalized = normalizeSectionSync(config);
  const canonicalFolder = canonicalPath(folder, true);
  if (canonicalFolder === null) return normalized;
  normalized.include_folders = normalized.include_folders
    .filter((value) => value !== canonicalFolder);
  normalized.exclude_folders = normalized.exclude_folders
    .filter((value) => value !== canonicalFolder);
  const target = selected ? normalized.include_folders : normalized.exclude_folders;
  target.push(canonicalFolder);
  target.sort(comparePaths);
  return normalized;
}


export function matchesNodeFolderFilters(name, folderFilters = null) {
  const canonicalName = canonicalPath(name, false);
  if (!canonicalName) return false;
  return nodeFilterMatcher(normalizedNodeFilters(folderFilters))(folderOf(canonicalName));
}


export function isSectionSyncCatalogMember(name, config, folderFilters = null) {
  const canonicalName = canonicalPath(name, false);
  if (!canonicalName) return false;
  const folder = folderOf(canonicalName);
  const normalized = normalizeSectionSync(config);
  return folderRuleMatcher(normalized)(folder)
    && nodeFilterMatcher(normalizedNodeFilters(folderFilters))(folder);
}


export function eligibleSectionSyncNames(catalogNames, config, folderFilters = null) {
  return eligibleNamesWithNormalizedConfig(
    catalogNames,
    normalizeSectionSync(config),
    folderFilters,
  );
}


export function deriveSectionSyncStatus(
  catalogNames,
  existingNames,
  config,
  folderFilters = null,
) {
  const normalized = normalizeSectionSync(config);
  const eligible = eligibleNamesWithNormalizedConfig(
    catalogNames,
    normalized,
    folderFilters,
  );
  return {
    config: normalized,
    eligible,
    actionable: actionableNamesFromEligible(eligible, existingNames, normalized),
  };
}


export function actionableSectionSyncNames(
  catalogNames,
  existingNames,
  config,
  folderFilters = null,
) {
  return deriveSectionSyncStatus(
    catalogNames,
    existingNames,
    config,
    folderFilters,
  ).actionable;
}


export function resetSectionSyncBaseline(config, catalogNames, folderFilters = null) {
  const normalized = normalizeSectionSync(config);
  normalized.seen_names = eligibleNamesWithNormalizedConfig(
    catalogNames,
    normalized,
    folderFilters,
  );
  return normalized;
}


export function markSectionSyncSeen(config, names) {
  const normalized = normalizeSectionSync(config);
  normalized.seen_names = namesFrom([
    ...normalized.seen_names,
    ...(Array.isArray(names) ? names : []),
  ]);
  return normalized;
}


export function addIgnoredIdentity(config, identity) {
  const normalized = normalizeSectionSync(config);
  const addition = normalizedIdentity(identity);
  if (!addition) return normalized;
  normalized.ignored = normalizeIgnored([
    ...normalized.ignored.filter((entry) => entry.name !== addition.name),
    addition,
  ]);
  return normalized;
}


export function removeIgnoredIdentity(config, identity) {
  const normalized = normalizeSectionSync(config);
  const removal = normalizedIdentity(identity);
  if (!removal) return normalized;
  normalized.ignored = normalized.ignored.filter((entry) => entry.name !== removal.name);
  return normalized;
}


function withoutExplicitlyAddedIgnoredIdentities(
  normalized,
  identities,
  catalogNames,
) {
  const additions = (Array.isArray(identities) ? identities : [])
    .map(normalizedIdentity)
    .filter(Boolean);
  if (!additions.length) return normalized;
  const additionNames = new Set(additions.map((identity) => identity.name));
  const additionHashes = new Set(
    additions.map((identity) => identity.sha256).filter(Boolean),
  );
  const catalogKnown = Array.isArray(catalogNames);
  const catalog = new Set(namesFrom(catalogNames));
  normalized.ignored = normalized.ignored.filter((entry) => !(
    additionNames.has(entry.name)
    || (
      entry.sha256
      && additionHashes.has(entry.sha256)
      && catalogKnown
      && !catalog.has(entry.name)
    )
  ));
  return normalized;
}


export function removeIgnoredIdentityForExplicitAdd(
  config,
  identity,
  catalogNames = null,
) {
  return withoutExplicitlyAddedIgnoredIdentities(
    normalizeSectionSync(config),
    [identity],
    catalogNames,
  );
}


export function recordSectionSyncExplicitAdditions(
  config,
  identities,
  catalogNames = null,
) {
  const normalizedConfig = normalizeSectionSync(config);
  const matchesRules = folderRuleMatcher(normalizedConfig);
  const additions = (Array.isArray(identities) ? identities : [])
    .map(normalizedIdentity)
    .filter(Boolean);
  const managedAdditions = additions.filter(
    (identity) => matchesRules(folderOf(identity.name)),
  );
  const normalized = withoutExplicitlyAddedIgnoredIdentities(
    normalizedConfig,
    additions,
    catalogNames,
  );
  if (normalized.mode === "new") {
    normalized.seen_names = namesFrom([
      ...normalized.seen_names,
      ...managedAdditions,
    ]);
  }
  return normalized;
}


export function reconcileIgnoredIdentity(config, identity, catalogNames = null) {
  return reconcileIgnoredIdentities(
    config,
    [identity],
    catalogNames,
  );
}


export function reconcileIgnoredIdentities(config, identities, catalogNames = null) {
  const additions = (Array.isArray(identities) ? identities : [])
    .map(normalizedIdentity)
    .filter(Boolean);
  const normalized = withoutExplicitlyAddedIgnoredIdentities(
    normalizeSectionSync(config),
    additions,
    catalogNames,
  );
  normalized.ignored = normalizeIgnored([
    ...normalized.ignored,
    ...additions,
  ]);
  return normalized;
}


export function planVerifiedSyncCandidates(
  actionableNames,
  verifiedIdentities,
  existingRows,
  config,
  catalogNames = [],
) {
  const requested = namesFrom(actionableNames);
  const verifiedByName = new Map();
  for (const value of Array.isArray(verifiedIdentities) ? verifiedIdentities : []) {
    const identity = normalizedIdentity(value);
    if (identity && !verifiedByName.has(identity.name)) {
      verifiedByName.set(identity.name, identity);
    }
  }
  const existing = (Array.isArray(existingRows) ? existingRows : [])
    .map((row) => {
      const identity = normalizedIdentity(row);
      return identity
        ? { ...identity, id: typeof row?.id === "string" ? row.id : "" }
        : null;
    })
    .filter(Boolean);
  const catalog = new Set(namesFrom(catalogNames));
  const ignored = normalizeSectionSync(config).ignored;
  const ignoredNames = new Set(ignored.map((entry) => entry.name));
  const renamedIgnoredHashes = new Set(
    ignored
      .filter((entry) => entry.sha256 && !catalog.has(entry.name))
      .map((entry) => entry.sha256),
  );
  const existingNames = new Set(existing.map((entry) => entry.name));
  const missingRowsByHash = new Map();
  for (const entry of existing) {
    if (!entry.sha256 || catalog.has(entry.name)) continue;
    if (!missingRowsByHash.has(entry.sha256)) missingRowsByHash.set(entry.sha256, []);
    missingRowsByHash.get(entry.sha256).push(entry);
  }
  const usedRenameRows = new Set();
  const additionNames = new Set();
  const additions = [];
  const renames = [];
  const skipped = [];

  for (const name of requested) {
    const identity = verifiedByName.get(name);
    if (!identity || !identity.sha256) {
      skipped.push({ name, reason: "unverified" });
      continue;
    }
    if (
      ignoredNames.has(identity.name)
      || renamedIgnoredHashes.has(identity.sha256)
    ) {
      skipped.push({ name, reason: "ignored" });
      continue;
    }
    if (existingNames.has(identity.name)) {
      skipped.push({ name, reason: "existing" });
      continue;
    }
    const renamedRow = (missingRowsByHash.get(identity.sha256) || [])
      .find((entry) => !usedRenameRows.has(entry.id));
    if (renamedRow) {
      usedRenameRows.add(renamedRow.id);
      renames.push({ row_id: renamedRow.id, identity });
      skipped.push({ name, reason: "renamed" });
      continue;
    }
    if (additionNames.has(identity.name)) continue;
    additionNames.add(identity.name);
    additions.push(identity);
  }
  return { additions, renames, skipped };
}
