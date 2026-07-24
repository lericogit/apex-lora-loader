import assert from "node:assert/strict";
import test from "node:test";

import {
  actionableSectionSyncNames,
  addIgnoredIdentity,
  canonicalFolderPath,
  canonicalRelativePath,
  eligibleSectionSyncNames,
  isSectionSyncCatalogMember,
  isSectionSyncFolderSelected,
  markSectionSyncSeen,
  matchesNodeFolderFilters,
  matchesSectionSyncFolders,
  normalizeSectionSync,
  normalizeSectionSyncIdentity,
  planVerifiedSyncCandidates,
  reconcileIgnoredIdentity,
  reconcileIgnoredIdentities,
  recordSectionSyncExplicitAdditions,
  removeIgnoredIdentity,
  removeIgnoredIdentityForExplicitAdd,
  resetSectionSyncBaseline,
  sectionSyncFolderSelectionStates,
  sectionSyncFolderTree,
  setSectionSyncFolderSelected,
  summarizeSectionSyncDetections,
} from "../web/section_sync.js";


const hash = (letter) => letter.repeat(64);


function sync(overrides = {}) {
  return {
    enabled: true,
    mode: "mirror",
    include_folders: ["styles"],
    exclude_folders: [],
    seen_names: [],
    ignored: [],
    ...overrides,
  };
}


test("normalization canonicalizes slash paths and deduplicates deterministically", () => {
  assert.equal(canonicalRelativePath(" /styles\\anime//look.safetensors/ "), "styles/anime/look.safetensors");
  assert.equal(canonicalFolderPath(" /styles\\anime// "), "styles/anime");

  const normalized = normalizeSectionSync({
    enabled: 1,
    mode: "unknown",
    include_folders: ["styles\\anime", "styles/anime/", "", ""],
    exclude_folders: ["styles\\anime\\old", "styles/anime/old"],
    seen_names: ["z.safetensors", "A.safetensors", "z.safetensors"],
    ignored: [
      { name: "styles\\b.safetensors", sha256: hash("b").toUpperCase(), size: 4.8 },
      { name: "styles/b.safetensors", sha256: hash("b"), size: 4 },
    ],
  });

  assert.deepEqual(normalized, {
    enabled: false,
    auto_sync: false,
    mode: "mirror",
    include_folders: ["", "styles/anime"],
    exclude_folders: ["styles/anime/old"],
    seen_names: ["A.safetensors", "z.safetensors"],
    ignored: [{ name: "styles/b.safetensors", sha256: hash("b"), size: 4 }],
  });
});


test("folder rules include recursive current and future children and exclude subtrees", () => {
  const config = sync({
    include_folders: ["styles"],
    exclude_folders: ["styles/private"],
  });

  assert.equal(matchesSectionSyncFolders("styles/root.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("styles/anime/new/future.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("styles/private/no.safetensors", config), false);
  assert.equal(matchesSectionSyncFolders("styles/private/deeper/no.safetensors", config), false);
  assert.equal(matchesSectionSyncFolders("other/no.safetensors", config), false);
});


test("the most-specific nested folder rule overrides its ancestors", () => {
  const config = sync({
    include_folders: ["A", "A/B/C"],
    exclude_folders: ["A/B"],
  });

  assert.equal(matchesSectionSyncFolders("A/selected.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("A/future/selected.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("A/B/excluded.safetensors", config), false);
  assert.equal(matchesSectionSyncFolders("A/B/future/excluded.safetensors", config), false);
  assert.equal(matchesSectionSyncFolders("A/B/C/selected-again.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("A/B/C/future/selected-again.safetensors", config), true);
});


test("folder selections can be overridden interactively at any tree depth", () => {
  let config = sync({
    include_folders: ["A"],
    exclude_folders: ["A/B"],
  });
  config = setSectionSyncFolderSelected(config, "A/B/C", true);
  assert.equal(isSectionSyncFolderSelected("A", config), true);
  assert.equal(isSectionSyncFolderSelected("A/B", config), false);
  assert.equal(isSectionSyncFolderSelected("A/B/C", config), true);
  assert.equal(matchesSectionSyncFolders("A/B/C/future/yes.safetensors", config), true);

  config = setSectionSyncFolderSelected(config, "A/B/C", false);
  assert.equal(isSectionSyncFolderSelected("A/B/C", config), false);
});


test("folder selection states derive all visible folders from one normalized config", () => {
  const states = sectionSyncFolderSelectionStates(
    ["", "A", "A/B", "A/B/C", "other"],
    sync({
      include_folders: ["A", "A/B/C"],
      exclude_folders: ["A/B"],
    }),
  );

  assert.deepEqual([...states], [
    ["", false],
    ["A", true],
    ["A/B", false],
    ["A/B/C", true],
    ["other", false],
  ]);
});


test("folder tree keeps descendants directly after parents with cumulative indentation", () => {
  assert.deepEqual(sectionSyncFolderTree([
    "krea2/style",
    "krea2/characters/bernard/deeper",
    "krea2/nsfw",
    "krea2/characters",
    "",
    "krea2/characters/9bitez",
    "krea2",
    "krea2/characters/bernard",
  ]), [
    { folder: "", depth: 0 },
    { folder: "krea2", depth: 1 },
    { folder: "krea2/characters", depth: 2 },
    { folder: "krea2/characters/9bitez", depth: 3 },
    { folder: "krea2/characters/bernard", depth: 3 },
    { folder: "krea2/characters/bernard/deeper", depth: 4 },
    { folder: "krea2/nsfw", depth: 2 },
    { folder: "krea2/style", depth: 2 },
  ]);
});


test("normalization removes exact include and exclude conflicts deterministically", () => {
  const normalized = normalizeSectionSync({
    include_folders: ["A/B", "A/B/C"],
    exclude_folders: ["A/B", "A"],
  });

  assert.deepEqual(normalized.include_folders, ["A/B", "A/B/C"]);
  assert.deepEqual(normalized.exclude_folders, ["A"]);
});


test("root inclusion is recursive while the existing root filter remains root-only", () => {
  const config = sync({ include_folders: [""], exclude_folders: ["blocked"] });

  assert.equal(matchesSectionSyncFolders("root.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("nested/future.safetensors", config), true);
  assert.equal(matchesSectionSyncFolders("blocked/no.safetensors", config), false);
  assert.equal(matchesNodeFolderFilters("root.safetensors", [""]), true);
  assert.equal(matchesNodeFolderFilters("nested/no.safetensors", [""]), false);
});


test("effective catalog membership intersects sync rules with node folder filters", () => {
  const config = sync({ include_folders: ["styles", "characters"] });

  assert.equal(isSectionSyncCatalogMember("styles/a.safetensors", config, null), true);
  assert.equal(isSectionSyncCatalogMember("styles/anime/a.safetensors", config, ["styles/anime"]), true);
  assert.equal(isSectionSyncCatalogMember("styles/photo/a.safetensors", config, ["styles/anime"]), false);
  assert.equal(isSectionSyncCatalogMember("characters/a.safetensors", config, []), false);
});


test("eligible names are canonical, deduplicated, and deterministically ordered", () => {
  const names = eligibleSectionSyncNames([
    "styles\\z.safetensors",
    "other/no.safetensors",
    "styles/A.safetensors",
    "styles/z.safetensors",
    { name: "styles/deep/b.safetensors" },
  ], sync());

  assert.deepEqual(names, [
    "styles/A.safetensors",
    "styles/deep/b.safetensors",
    "styles/z.safetensors",
  ]);
});


test("mirror mode offers eligible absent names unless their exact name is ignored", () => {
  const config = sync({
    seen_names: ["styles/seen.safetensors"],
    ignored: [{ name: "styles/ignored.safetensors", sha256: "", size: null }],
  });
  const names = actionableSectionSyncNames([
    "styles/new.safetensors",
    "styles/seen.safetensors",
    "styles/existing.safetensors",
    "styles/ignored.safetensors",
  ], ["styles/existing.safetensors"], config);

  assert.deepEqual(names, ["styles/new.safetensors", "styles/seen.safetensors"]);
});


test("new mode additionally excludes every name recorded by its baseline", () => {
  const config = sync({
    mode: "new",
    seen_names: ["styles/old.safetensors"],
  });
  const names = actionableSectionSyncNames([
    "styles/new.safetensors",
    "styles/old.safetensors",
  ], [], config);

  assert.deepEqual(names, ["styles/new.safetensors"]);
  assert.deepEqual(actionableSectionSyncNames(
    ["styles/new.safetensors"],
    [],
    { ...config, enabled: false },
  ), []);
});


test("manual detection summaries aggregate LoRAs and section names without duplicates", () => {
  assert.deepEqual(summarizeSectionSyncDetections([
    {
      section_id: "characters",
      section_name: "Characters",
      names: ["new/b.safetensors", "new/a.safetensors", "new/a.safetensors"],
    },
    {
      section_id: "styles",
      section_name: " Styles ",
      names: ["styles/c.safetensors"],
    },
    {
      section_id: "empty",
      section_name: "Empty",
      names: [],
    },
  ]), {
    count: 3,
    section_count: 2,
    section_names: ["Characters", "Styles"],
    sections: [
      { section_id: "characters", section_name: "Characters", count: 2 },
      { section_id: "styles", section_name: "Styles", count: 1 },
    ],
  });
});


test("baseline reset records the current effective catalog without changing other settings", () => {
  const config = sync({
    mode: "new",
    include_folders: [""],
    seen_names: ["obsolete.safetensors"],
  });
  const reset = resetSectionSyncBaseline(config, [
    "root.safetensors",
    "allowed/a.safetensors",
    "outside/a.safetensors",
  ], ["", "allowed"]);

  assert.deepEqual(reset.seen_names, [
    "allowed/a.safetensors",
    "root.safetensors",
  ]);
  assert.equal(reset.enabled, true);
  assert.equal(reset.mode, "new");
  assert.deepEqual(config.seen_names, ["obsolete.safetensors"]);
});


test("seen names are acknowledged deterministically without mutating the source", () => {
  const original = sync({ mode: "new", seen_names: ["styles/a.safetensors"] });
  const updated = markSectionSyncSeen(original, [
    "styles\\b.safetensors",
    "styles/a.safetensors",
  ]);
  assert.deepEqual(updated.seen_names, [
    "styles/a.safetensors",
    "styles/b.safetensors",
  ]);
  assert.deepEqual(original.seen_names, ["styles/a.safetensors"]);
});


test("ignored identities preserve separately named duplicates and remove exact entries", () => {
  const original = sync();
  const first = addIgnoredIdentity(original, {
    name: "styles/old.safetensors",
    sha256: hash("a"),
    size: 10,
  });
  const renamed = addIgnoredIdentity(first, {
    name: "styles/new.safetensors",
    sha256: hash("a"),
    size: 10,
  });

  assert.deepEqual(original.ignored, []);
  assert.deepEqual(renamed.ignored, [
    {
      name: "styles/new.safetensors",
      sha256: hash("a"),
      size: 10,
    },
    {
      name: "styles/old.safetensors",
      sha256: hash("a"),
      size: 10,
    },
  ]);
  assert.deepEqual(removeIgnoredIdentity(renamed, {
    name: "styles/new.safetensors",
    sha256: hash("a"),
  }).ignored, [{
    name: "styles/old.safetensors",
    sha256: hash("a"),
    size: 10,
  }]);
});


test("explicit re-add and ignored rename reconciliation distinguish live duplicate files", () => {
  const config = sync({
    ignored: [{
      name: "styles/old.safetensors",
      sha256: hash("a"),
      size: 10,
    }],
  });
  const duplicate = {
    name: "styles/copy.safetensors",
    sha256: hash("a"),
    size: 10,
  };

  assert.deepEqual(removeIgnoredIdentityForExplicitAdd(
    config,
    duplicate,
    ["styles/old.safetensors", "styles/copy.safetensors"],
  ).ignored, config.ignored);
  assert.deepEqual(removeIgnoredIdentityForExplicitAdd(
    config,
    duplicate,
    ["styles/copy.safetensors"],
  ).ignored, []);
  assert.deepEqual(reconcileIgnoredIdentity(
    config,
    duplicate,
    ["styles/copy.safetensors"],
  ).ignored, [duplicate]);
});


test("batched explicit additions update ignored entries and New-only seen state once", () => {
  const config = sync({
    mode: "new",
    seen_names: ["styles/old.safetensors"],
    ignored: [
      { name: "styles/live-duplicate.safetensors", sha256: hash("a"), size: 10 },
      { name: "styles/readd.safetensors", sha256: hash("b"), size: 11 },
    ],
  });
  const additions = [
    { name: "styles/copy.safetensors", sha256: hash("a"), size: 10 },
    { name: "styles/readd.safetensors", sha256: hash("b"), size: 11 },
    { name: "outside/not-linked.safetensors", sha256: hash("c"), size: 12 },
  ];
  const updated = recordSectionSyncExplicitAdditions(
    config,
    additions,
    [
      "styles/live-duplicate.safetensors",
      "styles/copy.safetensors",
      "styles/readd.safetensors",
    ],
  );

  assert.deepEqual(updated.ignored, [{
    name: "styles/live-duplicate.safetensors",
    sha256: hash("a"),
    size: 10,
  }]);
  assert.deepEqual(updated.seen_names, [
    "styles/copy.safetensors",
    "styles/old.safetensors",
    "styles/readd.safetensors",
  ]);
  assert.deepEqual(recordSectionSyncExplicitAdditions(
    sync({
      mode: "new",
      ignored: [{
        name: "outside/readd.safetensors",
        sha256: hash("f"),
        size: 13,
      }],
    }),
    [{
      name: "outside/readd.safetensors",
      sha256: hash("f"),
      size: 13,
    }],
    ["outside/readd.safetensors"],
  ), {
    enabled: true,
    auto_sync: false,
    mode: "new",
    include_folders: ["styles"],
    exclude_folders: [],
    seen_names: [],
    ignored: [],
  });

  assert.deepEqual(reconcileIgnoredIdentities(
    sync({
      ignored: [
        { name: "styles/gone-a.safetensors", sha256: hash("d"), size: 1 },
        { name: "styles/gone-b.safetensors", sha256: hash("e"), size: 2 },
      ],
    }),
    [
      { name: "styles/new-a.safetensors", sha256: hash("d"), size: 1 },
      { name: "styles/new-b.safetensors", sha256: hash("e"), size: 2 },
    ],
    ["styles/new-a.safetensors", "styles/new-b.safetensors"],
  ).ignored.map((entry) => entry.name), [
    "styles/new-a.safetensors",
    "styles/new-b.safetensors",
  ]);
});


test("verified identities discard response-only fields and synthetic request IDs", () => {
  assert.deepEqual(normalizeSectionSyncIdentity({
    id: "folder-sync-0",
    name: "styles/renamed.safetensors",
    sha256: hash("b"),
    size: 42,
    renamed: true,
    alternatives: ["other.safetensors"],
  }), {
    name: "styles/renamed.safetensors",
    sha256: hash("b"),
    size: 42,
  });
});


test("verified planning filters ignored identities and recovers missing renamed rows", () => {
  const config = sync({
    ignored: [{
      name: "styles/old-ignored-name.safetensors",
      sha256: hash("f"),
      size: 12,
    }],
  });
  const plan = planVerifiedSyncCandidates([
    "styles/add-z.safetensors",
    "styles/unverified.safetensors",
    "styles/renamed-ignored.safetensors",
    "styles/renamed-existing.safetensors",
    "styles/duplicate-copy.safetensors",
    "styles/add-a.safetensors",
  ], [
    { name: "styles/add-a.safetensors", sha256: hash("a"), size: 2 },
    { name: "styles/add-z.safetensors", sha256: hash("c"), size: 1 },
    { name: "styles/renamed-ignored.safetensors", sha256: hash("f"), size: 12 },
    { name: "styles/renamed-existing.safetensors", sha256: hash("e"), size: 9 },
    { name: "styles/duplicate-copy.safetensors", sha256: hash("d"), size: 7 },
  ], [
    { id: "missing-row", name: "styles/missing-old.safetensors", sha256: hash("e"), size: 9 },
    { id: "live-row", name: "styles/live.safetensors", sha256: hash("d"), size: 7 },
  ], config, [
    "styles/live.safetensors",
    "styles/add-z.safetensors",
    "styles/unverified.safetensors",
    "styles/renamed-ignored.safetensors",
    "styles/renamed-existing.safetensors",
    "styles/duplicate-copy.safetensors",
    "styles/add-a.safetensors",
  ]);

  assert.deepEqual(plan.additions.map((entry) => entry.name), [
    "styles/add-a.safetensors",
    "styles/add-z.safetensors",
    "styles/duplicate-copy.safetensors",
  ]);
  assert.deepEqual(plan.renames, [{
    row_id: "missing-row",
    identity: {
      name: "styles/renamed-existing.safetensors",
      sha256: hash("e"),
      size: 9,
    },
  }]);
  assert.deepEqual(plan.skipped, [
    { name: "styles/renamed-existing.safetensors", reason: "renamed" },
    { name: "styles/renamed-ignored.safetensors", reason: "ignored" },
    { name: "styles/unverified.safetensors", reason: "unverified" },
  ]);
});


test("verified planning preserves a separately named duplicate of a live ignored file", () => {
  const config = sync({
    ignored: [{
      name: "styles/ignored-live.safetensors",
      sha256: hash("d"),
      size: 7,
    }],
  });
  const plan = planVerifiedSyncCandidates(
    ["styles/duplicate.safetensors"],
    [{
      name: "styles/duplicate.safetensors",
      sha256: hash("d"),
      size: 7,
    }],
    [],
    config,
    [
      "styles/ignored-live.safetensors",
      "styles/duplicate.safetensors",
    ],
  );

  assert.deepEqual(plan.additions, [{
    name: "styles/duplicate.safetensors",
    sha256: hash("d"),
    size: 7,
  }]);
  assert.deepEqual(plan.skipped, []);
});
