import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = ROOT.parents[1]
sys.path.insert(0, str(COMFY_ROOT))
PACKAGE = "apex_lora_loader_tests"


def load_module(name, filename):
    package = sys.modules.get(PACKAGE)
    if package is None:
        package = types.ModuleType(PACKAGE)
        package.__path__ = [str(ROOT)]
        sys.modules[PACKAGE] = package
    full_name = f"{PACKAGE}.{name}"
    spec = importlib.util.spec_from_file_location(full_name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = module
    spec.loader.exec_module(module)
    return module


services = load_module("services", "services.py")
nodes = load_module("nodes", "nodes.py")


def row(
    name,
    enabled=True,
    strength=1.0,
    digest=None,
    size=3,
    row_id=None,
    trigger_words=None,
    active_trigger_words=None,
    active_trigger_word=None,
    trigger_position=None,
):
    entry = {
        "id": row_id or name,
        "name": name,
        "enabled": enabled,
        "strength": strength,
        "sha256": digest or (name[0].lower() * 64),
        "size": size,
    }
    if trigger_words is not None:
        entry["trigger_words"] = trigger_words
        if active_trigger_words is not None:
            entry["active_trigger_words"] = active_trigger_words
        elif active_trigger_word is not None:
            entry["active_trigger_word"] = active_trigger_word
    if trigger_position is not None:
        entry["trigger_position"] = trigger_position
    return entry


def state(*sections):
    return json.dumps({
        "version": 1,
        "folder_filters": None,
        "active_preset_id": None,
        "sections": [
            {"id": str(index), "name": f"Section {index}", "collapsed": False, "loras": entries}
            for index, entries in enumerate(sections)
        ],
    })


def make_catalog_files(tmp_path, files):
    paths = {}
    for name, content in files.items():
        path = tmp_path / name.replace("/", "_")
        path.write_bytes(content)
        paths[name] = str(path)
    return paths


class BackendTests(unittest.TestCase):
    def test_parse_state_preserves_section_and_row_order(self):
        parsed = nodes.parse_state(state([row("A.safetensors")], [row("B.safetensors")]))
        self.assertEqual([entry["name"] for entry in parsed], ["A.safetensors", "B.safetensors"])

    def test_parse_state_rejects_invalid_strength(self):
        for bad_strength in (True, float("inf"), -101, 101):
            with self.subTest(strength=bad_strength), self.assertRaisesRegex(ValueError, "Strength"):
                nodes.parse_state(state([row("A.safetensors", strength=bad_strength)]))

    def test_parse_state_rounds_strength_to_two_decimals(self):
        [parsed] = nodes.parse_state(state([row("A.safetensors", strength=3.457475457)]))
        self.assertEqual(parsed["strength"], 3.46)

    def test_node_exposes_optional_prompt_socket_and_output(self):
        input_types = nodes.ApexLoraLoader.INPUT_TYPES()
        self.assertEqual(input_types["optional"]["prompt"][0], "STRING")
        self.assertTrue(input_types["optional"]["prompt"][1]["forceInput"])
        self.assertEqual(input_types["optional"]["preset_jobs"][0], "APEX_PRESET_JOBS")
        self.assertEqual(nodes.ApexLoraLoader.RETURN_TYPES, ("MODEL", "STRING"))
        self.assertEqual(nodes.ApexLoraLoader.RETURN_NAMES, ("model", "prompt"))

    def test_parse_state_validates_trigger_selection_and_position(self):
        invalid_active = row(
            "A.safetensors",
            trigger_words=["one"],
            active_trigger_words=["missing"],
        )
        with self.assertRaisesRegex(ValueError, "selected from"):
            nodes.parse_state(state([invalid_active]))
        invalid_position = row("A.safetensors", trigger_position="middle")
        with self.assertRaisesRegex(ValueError, "prepend or append"):
            nodes.parse_state(state([invalid_position]))

    def test_parse_state_migrates_legacy_active_trigger_word(self):
        [parsed] = nodes.parse_state(state([row(
            "A.safetensors",
            trigger_words=["one", "two"],
            active_trigger_word="two",
        )]))
        self.assertEqual(parsed["active_trigger_words"], ["two"])

    def test_prompt_augmentation_uses_enabled_nonzero_rows_in_visual_order(self):
        entries = [
            row(
                "A.safetensors",
                trigger_words=["alpha", "apex"],
                active_trigger_words=["alpha", "apex"],
                trigger_position="prepend",
            ),
            row(
                "B.safetensors",
                enabled=False,
                trigger_words=["disabled"],
                active_trigger_words=["disabled"],
            ),
            row(
                "C.safetensors",
                strength=-0.5,
                trigger_words=["charlie"],
                active_trigger_words=["charlie"],
            ),
            row(
                "D.safetensors",
                strength=0,
                trigger_words=["zero"],
                active_trigger_words=["zero"],
            ),
            row(
                "E.safetensors",
                trigger_words=["echo"],
                active_trigger_words=["echo"],
                trigger_position="prepend",
            ),
        ]
        parsed = nodes.parse_state(state(entries))
        self.assertEqual(
            nodes.augment_prompt("  portrait  ", parsed),
            "alpha, apex, echo, portrait, charlie",
        )
        self.assertEqual(nodes.augment_prompt("", parsed), "alpha, apex, echo, charlie")

    def test_prompt_passes_through_exactly_without_contributing_triggers(self):
        entries = [
            row("A.safetensors", enabled=False, trigger_words=["skip"], active_trigger_words=["skip"]),
            row("B.safetensors", strength=0, trigger_words=["skip"], active_trigger_words=["skip"]),
            row("C.safetensors", trigger_words=["saved but off"], active_trigger_words=[]),
        ]
        prompt = "  untouched, prompt  "
        self.assertEqual(nodes.augment_prompt(prompt, nodes.parse_state(state(entries))), prompt)
        with self.assertRaisesRegex(ValueError, "must be a string"):
            nodes.augment_prompt(None, [])

    def test_prompt_augmentation_preserves_duplicate_row_triggers(self):
        entries = [
            row("A.safetensors", trigger_words=["same"], active_trigger_words=["same"]),
            row("B.safetensors", trigger_words=["same"], active_trigger_words=["same"]),
        ]
        self.assertEqual(
            nodes.augment_prompt("base", nodes.parse_state(state(entries))),
            "base, same, same",
        )

    def test_loader_matches_core_model_only_contract_and_execution_cache(self):
        entries = [
            row("A.safetensors", enabled=False, trigger_words=["disabled"], active_trigger_words=["disabled"]),
            row("B.safetensors", strength=0, trigger_words=["zero"], active_trigger_words=["zero"]),
            row(
                "C.safetensors",
                strength=0.5,
                trigger_words=["c-trigger"],
                active_trigger_words=["c-trigger"],
                trigger_position="prepend",
            ),
            row(
                "C.safetensors",
                strength=-0.25,
                row_id="C2",
                trigger_words=["c-trigger"],
                active_trigger_words=["c-trigger"],
            ),
            row(
                "D.safetensors",
                strength=1.25,
                trigger_words=["d-trigger"],
                active_trigger_words=["d-trigger"],
                trigger_position="prepend",
            ),
        ]
        paths = {"C.safetensors": "C-path", "D.safetensors": "D-path"}
        loads = []
        applies = []

        def resolve(entry):
            return {
                "name": entry["name"],
                "path": paths[entry["name"]],
                "sha256": entry["sha256"],
                "size": entry["size"],
                "renamed": False,
            }

        def load_file(path, **kwargs):
            loads.append((path, kwargs))
            return f"weights:{path}", {"source": path}

        def apply(model, clip, lora, strength_model, strength_clip, lora_metadata=None):
            applies.append((model, clip, lora, strength_model, strength_clip, lora_metadata))
            return f"{model}>{lora}@{strength_model}", None

        with (
            patch.object(nodes.LORA_CATALOG, "resolve", side_effect=resolve),
            patch.object(nodes.folder_paths, "get_full_path_or_raise", side_effect=lambda _kind, name: paths[name]),
            patch.object(nodes.comfy.utils, "load_torch_file", side_effect=load_file),
            patch.object(nodes.comfy.sd, "load_lora_for_models", side_effect=apply),
        ):
            result = nodes.ApexLoraLoader().load_loras(
                "base",
                state(entries),
                prompt="subject",
                preset_jobs={"ignored": True},
                unique_id=None,
            )

        self.assertEqual([item[0] for item in loads], ["C-path", "D-path"])
        self.assertTrue(all(item[1] == {"safe_load": True, "return_metadata": True} for item in loads))
        self.assertEqual([item[3] for item in applies], [0.5, -0.25, 1.25])
        self.assertTrue(all(item[1] is None and item[4] == 0 for item in applies))
        self.assertEqual(
            [item[5] for item in applies],
            [{"source": "C-path"}, {"source": "C-path"}, {"source": "D-path"}],
        )
        self.assertTrue(result[0].endswith("weights:D-path@1.25"))
        self.assertEqual(result[1], "c-trigger, d-trigger, subject, c-trigger")

    def test_disabled_missing_lora_is_not_resolved(self):
        with patch.object(
            nodes.LORA_CATALOG,
            "resolve",
            side_effect=AssertionError("disabled LoRA should not be resolved"),
        ):
            result = nodes.ApexLoraLoader().load_loras(
                "base", state([row("A.safetensors", enabled=False)])
            )
        self.assertEqual(result[0], "base")
        self.assertEqual(result[1], "")

    def test_catalog_recovers_rename_by_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            paths = make_catalog_files(tmp_path, {"old.safetensors": b"same lora"})
            catalog = services.LoraCatalog()
            with (
                patch.object(services.folder_paths, "get_filename_list", side_effect=lambda _kind: list(paths)),
                patch.object(services.folder_paths, "get_full_path", side_effect=lambda _kind, name: paths.get(name)),
            ):
                identity = catalog.identify("old.safetensors")
                old_path = paths.pop("old.safetensors")
                paths["folder/new.safetensors"] = old_path
                resolved = catalog.resolve(identity)
        self.assertEqual(resolved["name"], "folder/new.safetensors")
        self.assertTrue(resolved["renamed"])

    def test_catalog_does_not_match_changed_or_same_size_content(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            paths = make_catalog_files(tmp_path, {"old.safetensors": b"aaaa"})
            catalog = services.LoraCatalog()
            with (
                patch.object(services.folder_paths, "get_filename_list", side_effect=lambda _kind: list(paths)),
                patch.object(services.folder_paths, "get_full_path", side_effect=lambda _kind, name: paths.get(name)),
            ):
                identity = catalog.identify("old.safetensors")
                paths.pop("old.safetensors")
                other = tmp_path / "other.safetensors"
                other.write_bytes(b"bbbb")
                paths["other.safetensors"] = str(other)
                with self.assertRaisesRegex(FileNotFoundError, "no file matches"):
                    catalog.resolve(identity)

    def test_catalog_uses_deterministic_identical_match(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            paths = make_catalog_files(tmp_path, {"old.safetensors": b"copy"})
            catalog = services.LoraCatalog()
            with (
                patch.object(services.folder_paths, "get_filename_list", side_effect=lambda _kind: list(paths)),
                patch.object(services.folder_paths, "get_full_path", side_effect=lambda _kind, name: paths.get(name)),
            ):
                identity = catalog.identify("old.safetensors")
                paths.pop("old.safetensors")
                a = tmp_path / "a.safetensors"
                z = tmp_path / "z.safetensors"
                a.write_bytes(b"copy")
                z.write_bytes(b"copy")
                paths.update({"z.safetensors": str(z), "a.safetensors": str(a)})
                resolved = catalog.resolve(identity)
        self.assertEqual(resolved["name"], "a.safetensors")
        self.assertEqual(resolved["alternatives"], 1)

    def test_catalog_rejects_unknown_path(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = make_catalog_files(Path(directory), {"safe.safetensors": b"data"})
            catalog = services.LoraCatalog()
            with (
                patch.object(services.folder_paths, "get_filename_list", side_effect=lambda _kind: list(paths)),
                patch.object(services.folder_paths, "get_full_path", side_effect=lambda _kind, name: paths.get(name)),
                self.assertRaises(FileNotFoundError),
            ):
                catalog.identify("../safe.safetensors")

    def test_catalog_repairs_missing_identity_for_an_existing_name(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = make_catalog_files(Path(directory), {"safe.safetensors": b"data"})
            catalog = services.LoraCatalog()
            with (
                patch.object(services.folder_paths, "get_filename_list", side_effect=lambda _kind: list(paths)),
                patch.object(services.folder_paths, "get_full_path", side_effect=lambda _kind, name: paths.get(name)),
            ):
                resolved = catalog.resolve({"name": "safe.safetensors"})
        self.assertEqual(resolved["sha256"], "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7")
        self.assertEqual(resolved["size"], 4)

    def test_catalog_discards_one_digest_or_clears_the_hash_cache(self):
        catalog = services.LoraCatalog()
        digest_a = "a" * 64
        digest_b = "b" * 64
        catalog._hash_cache.update({
            ("first", 1, 1): digest_a,
            ("second", 1, 1): digest_b,
            ("renamed", 1, 1): digest_a,
        })

        self.assertEqual(catalog.discard_digest("A" * 64), 2)
        self.assertEqual(list(catalog._hash_cache.values()), [digest_b])
        with self.assertRaisesRegex(ValueError, "valid SHA-256"):
            catalog.discard_digest("invalid")
        self.assertEqual(catalog.clear_hash_cache(), 1)
        self.assertEqual(catalog.clear_hash_cache(), 0)
        self.assertEqual(catalog._hash_cache, {})

    def test_preset_store_crud_and_name_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            store = services.PresetStore(str(tmp_path / "presets.json"))
            first = store.upsert({
                "name": "Portrait",
                "entries": [{
                    "name": "A.safetensors",
                    "sha256": "a" * 64,
                    "size": 3,
                    "strength": 0.8,
                }],
            })
            self.assertEqual(store.read()["presets"], [first])
            renamed = store.rename(first["id"], "Faces")
            self.assertEqual(renamed["name"], "Faces")
            store.upsert({"name": "Empty", "entries": []})
            with self.assertRaises(FileExistsError):
                store.upsert({"name": "faces", "entries": []})
            store.delete(first["id"])
            self.assertEqual([item["name"] for item in store.read()["presets"]], ["Empty"])
            self.assertFalse(list(tmp_path.glob("*.tmp")))

    def test_preset_store_migrates_v1_and_missing_types_to_active(self):
        preset_id = "00000000-0000-4000-8000-000000000001"
        legacy_preset = {
            "id": preset_id,
            "name": "Legacy",
            "entries": [{
                "name": "A.safetensors",
                "sha256": "a" * 64,
                "size": 3,
                "strength": 0.8,
            }],
        }
        for version in (1, 2):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "presets.json"
                path.write_text(json.dumps({
                    "version": version,
                    "presets": [legacy_preset],
                }), encoding="utf-8")

                data = services.PresetStore(str(path)).read()

                self.assertEqual(data["version"], 2)
                self.assertEqual(data["presets"], [{
                    **legacy_preset,
                    "type": "active",
                }])

    def test_full_preset_roundtrip_preserves_order_and_strips_transient_state(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            store = services.PresetStore(str(tmp_path / "presets.json"))
            saved = store.upsert({
                "name": "Complete setup",
                "type": "full",
                "state": {
                    "version": 1,
                    "folder_filters": ["styles", ""],
                    "active_preset_id": "do-not-save",
                    "unknown": "discard",
                    "settings": {
                        "show_safetensors": False,
                        "show_folder_paths": True,
                        "show_trigger_button": True,
                        "strength_drag_step": 0.057,
                        "overlay_scale": 0.823,
                        "run_on_change_enabled": True,
                        "run_on_change_delay_ms": 451.6,
                        "unknown": "discard",
                    },
                    "sections": [
                        {
                            "id": "section-two",
                            "name": "Second",
                            "collapsed": True,
                            "column": 1,
                            "folder_sync": {
                                "enabled": True,
                                "auto_sync": True,
                                "mode": "new",
                                "include_folders": [
                                    "folder",
                                    "folder\\sub\\deep",
                                    "folder/sub/deep",
                                ],
                                "exclude_folders": [
                                    "folder\\sub",
                                    "folder/sub",
                                ],
                                "seen_names": [
                                    "seen\\first.safetensors",
                                    "seen/first.safetensors",
                                ],
                                "ignored": [
                                    {
                                        "name": "ignored\\old.safetensors",
                                        "sha256": "c" * 64,
                                        "size": 30,
                                    },
                                    {
                                        "name": "ignored/renamed.safetensors",
                                        "sha256": "c" * 64,
                                        "size": 30,
                                    },
                                    {
                                        "name": "ignored\\fallback.safetensors",
                                        "sha256": "invalid",
                                        "size": -1,
                                    },
                                    {
                                        "name": "ignored/fallback.safetensors",
                                    },
                                ],
                                "unknown": "discard",
                            },
                            "unknown": "discard",
                            "loras": [
                                {
                                    "id": "row-b",
                                    "name": "folder/B.safetensors",
                                    "enabled": False,
                                    "strength": -0.5733,
                                    "sha256": "b" * 64,
                                    "size": 20,
                                    "trigger_words": [" portrait ", "detail", "portrait"],
                                    "active_trigger_words": [" detail "],
                                    "trigger_position": "prepend",
                                    "error": "missing",
                                    "unknown": "discard",
                                },
                                {
                                    "id": "row-a",
                                    "name": "folder/A.safetensors",
                                    "enabled": True,
                                    "strength": 0.456,
                                    "sha256": "a" * 64,
                                    "size": 10,
                                    "trigger_words": [],
                                    "active_trigger_words": [],
                                    "trigger_position": "append",
                                },
                            ],
                        },
                        {
                            "id": "section-one",
                            "name": "First",
                            "collapsed": False,
                            "column": 0,
                            "loras": [],
                        },
                    ],
                },
            })

            self.assertEqual(saved["type"], "full")
            self.assertEqual(saved["state"]["settings"]["strength_drag_step"], 0.06)
            self.assertEqual(saved["state"]["settings"]["overlay_scale"], 0.82)
            self.assertTrue(saved["state"]["settings"]["run_on_change_enabled"])
            self.assertEqual(saved["state"]["settings"]["run_on_change_delay_ms"], 452)
            self.assertEqual(
                [section["id"] for section in saved["state"]["sections"]],
                ["section-two", "section-one"],
            )
            self.assertEqual(
                [entry["id"] for entry in saved["state"]["sections"][0]["loras"]],
                ["row-b", "row-a"],
            )
            self.assertEqual(
                [entry["strength"] for entry in saved["state"]["sections"][0]["loras"]],
                [-0.57, 0.46],
            )
            self.assertEqual(
                saved["state"]["sections"][0]["loras"][0]["trigger_words"],
                ["portrait", "detail"],
            )
            self.assertEqual(
                saved["state"]["sections"][0]["loras"][0]["active_trigger_words"],
                ["detail"],
            )
            self.assertEqual(
                saved["state"]["sections"][0]["folder_sync"],
                {
                    "enabled": True,
                    "auto_sync": True,
                    "mode": "new",
                    "include_folders": ["folder", "folder/sub/deep"],
                    "exclude_folders": ["folder/sub"],
                    "seen_names": ["seen/first.safetensors"],
                    "ignored": [
                        {
                            "name": "ignored/old.safetensors",
                            "sha256": "c" * 64,
                            "size": 30,
                        },
                        {
                            "name": "ignored/renamed.safetensors",
                            "sha256": "c" * 64,
                            "size": 30,
                        },
                        {
                            "name": "ignored/fallback.safetensors",
                            "sha256": "",
                            "size": 0,
                        },
                    ],
                },
            )
            self.assertEqual(
                saved["state"]["sections"][1]["folder_sync"],
                {
                    "enabled": False,
                    "auto_sync": False,
                    "mode": "mirror",
                    "include_folders": [],
                    "exclude_folders": [],
                    "seen_names": [],
                    "ignored": [],
                },
            )
            serialized = json.dumps(saved)
            self.assertNotIn("active_preset_id", serialized)
            self.assertNotIn("unknown", serialized)
            self.assertNotIn("missing", serialized)
            self.assertEqual(store.read()["presets"], [saved])
            self.assertEqual(json.loads((tmp_path / "presets.json").read_text(encoding="utf-8"))["version"], 2)
            self.assertFalse(list(tmp_path.glob("*.tmp")))

    def test_full_preset_legacy_sections_default_folder_sync_to_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            store = services.PresetStore(str(Path(directory) / "presets.json"))
            saved = store.upsert({
                "name": "Legacy full setup",
                "type": "full",
                "state": {
                    "version": 1,
                    "folder_filters": None,
                    "settings": {},
                    "sections": [{
                        "id": "legacy-section",
                        "name": "Legacy",
                        "collapsed": False,
                        "column": 0,
                        "loras": [],
                    }],
                },
            })

            expected = {
                "enabled": False,
                "auto_sync": False,
                "mode": "mirror",
                "include_folders": [],
                "exclude_folders": [],
                "seen_names": [],
                "ignored": [],
            }
            self.assertEqual(saved["state"]["sections"][0]["folder_sync"], expected)
            self.assertEqual(
                store.read()["presets"][0]["state"]["sections"][0]["folder_sync"],
                expected,
            )

    def test_full_preset_accepts_large_new_only_baseline(self):
        seen_names = [f"catalog/{index}.safetensors" for index in range(3000)]
        with tempfile.TemporaryDirectory() as directory:
            store = services.PresetStore(str(Path(directory) / "presets.json"))
            saved = store.upsert({
                "name": "Large catalog baseline",
                "type": "full",
                "state": {
                    "version": 1,
                    "folder_filters": None,
                    "settings": {},
                    "sections": [{
                        "id": "section",
                        "name": "Section",
                        "collapsed": False,
                        "column": 0,
                        "folder_sync": {
                            "enabled": True,
                            "auto_sync": True,
                            "mode": "new",
                            "include_folders": [""],
                            "exclude_folders": [],
                            "seen_names": seen_names,
                            "ignored": [],
                        },
                        "loras": [],
                    }],
                },
            })

            self.assertEqual(
                saved["state"]["sections"][0]["folder_sync"]["seen_names"],
                seen_names,
            )

    def test_full_preset_rejects_invalid_folder_sync(self):
        valid_state = {
            "version": 1,
            "folder_filters": None,
            "settings": {},
            "sections": [{
                "id": "section",
                "name": "Section",
                "collapsed": False,
                "column": 0,
                "loras": [],
            }],
        }
        invalid_values = [
            None,
            [],
            {"enabled": "yes"},
            {"auto_sync": "yes"},
            {"mode": "replace"},
            {"include_folders": "folder"},
            {"include_folders": [3]},
            {"include_folders": ["folder/../outside"]},
            {"exclude_folders": [None]},
            {"seen_names": [""]},
            {"include_folders": ["folder"], "exclude_folders": ["folder"]},
            {"ignored": "A.safetensors"},
            {"ignored": ["not-an-object"]},
            {"ignored": [{"name": "", "sha256": "a" * 64, "size": 1}]},
            {"include_folders": [f"folder/{index}" for index in range(3)]},
            {"exclude_folders": [f"folder/{index}" for index in range(3)]},
            {"seen_names": [f"{index}.safetensors" for index in range(3)]},
            {
                "ignored": [{
                    "name": f"{index}.safetensors",
                    "sha256": f"{index:064x}",
                    "size": index,
                } for index in range(3)],
            },
        ]

        with tempfile.TemporaryDirectory() as directory:
            store = services.PresetStore(str(Path(directory) / "presets.json"))
            with (
                patch.object(services, "FOLDER_SYNC_MAX_RULES", 2),
                patch.object(services, "FOLDER_SYNC_MAX_ITEMS", 2),
            ):
                for folder_sync in invalid_values:
                    preset = {
                        "name": "Invalid folder sync",
                        "type": "full",
                        "state": json.loads(json.dumps(valid_state)),
                    }
                    preset["state"]["sections"][0]["folder_sync"] = folder_sync
                    with self.subTest(folder_sync=folder_sync), self.assertRaises(ValueError):
                        store.upsert(preset)

    def test_preset_store_rejects_invalid_type_and_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            store = services.PresetStore(str(Path(directory) / "presets.json"))
            invalid_presets = [
                {"name": "Bad", "type": "unknown", "entries": []},
                {"name": "Bad", "type": "active", "state": {"version": 1, "sections": []}},
                {"name": "Bad", "type": "full", "entries": []},
                {
                    "name": "Bad",
                    "type": "full",
                    "state": {"version": 1, "folder_filters": None, "settings": {}, "sections": "bad"},
                },
                {
                    "name": "Bad delay",
                    "type": "full",
                    "state": {
                        "version": 1,
                        "folder_filters": None,
                        "settings": {"run_on_change_delay_ms": -1},
                        "sections": [{
                            "id": "section",
                            "name": "Section",
                            "collapsed": False,
                            "column": 0,
                            "loras": [],
                        }],
                    },
                },
            ]
            for preset in invalid_presets:
                with self.subTest(preset=preset), self.assertRaises(ValueError):
                    store.upsert(preset)

    def test_renaming_full_preset_preserves_type_and_state(self):
        with tempfile.TemporaryDirectory() as directory:
            store = services.PresetStore(str(Path(directory) / "presets.json"))
            saved = store.upsert({
                "name": "Before",
                "type": "full",
                "state": {
                    "version": 1,
                    "folder_filters": None,
                    "settings": {
                        "show_safetensors": True,
                        "show_folder_paths": True,
                        "show_trigger_button": False,
                        "strength_drag_step": 0.01,
                        "overlay_scale": 0.88,
                        "run_on_change_enabled": False,
                        "run_on_change_delay_ms": 450,
                    },
                    "sections": [{
                        "id": "section",
                        "name": "Saved",
                        "collapsed": False,
                        "column": 0,
                        "loras": [],
                    }],
                },
            })

            renamed = store.rename(saved["id"], "After")

            self.assertEqual(renamed["name"], "After")
            self.assertEqual(renamed["type"], "full")
            self.assertEqual(renamed["state"], saved["state"])
            self.assertEqual(store.read()["presets"], [renamed])

    def test_metadata_store_keys_trigger_words_by_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            store = services.LoraMetadataStore(str(tmp_path / "metadata.json"))
            identity = {
                "name": "folder/A.safetensors",
                "sha256": "a" * 64,
                "size": 123,
            }
            [recorded] = store.record_many([identity])
            self.assertEqual(recorded["trigger_words"], [])
            self.assertEqual(recorded["active_trigger_words"], [])

            saved = store.set_trigger_words(
                identity,
                [" portrait style ", "detail", "portrait style", ""],
                [" detail ", "portrait style"],
            )
            self.assertEqual(saved["trigger_words"], ["portrait style", "detail"])
            self.assertEqual(saved["active_trigger_words"], ["portrait style", "detail"])
            [renamed] = store.record_many([{
                **identity,
                "name": "renamed/A.safetensors",
            }])
            self.assertEqual(renamed["trigger_words"], ["portrait style", "detail"])
            self.assertEqual(renamed["active_trigger_words"], ["portrait style", "detail"])
            self.assertEqual(store.read()["entries"], [renamed])

            all_off = store.set_trigger_words(identity, ["portrait style", "detail"], [])
            self.assertEqual(all_off["trigger_words"], ["portrait style", "detail"])
            self.assertEqual(all_off["active_trigger_words"], [])
            [not_reseeded] = store.record_many([{
                **identity,
                "trigger_words": ["stale workflow value"],
                "active_trigger_words": ["stale workflow value"],
            }])
            self.assertEqual(not_reseeded["trigger_words"], ["portrait style", "detail"])
            self.assertEqual(not_reseeded["active_trigger_words"], [])
            self.assertFalse(list(tmp_path.glob("*.tmp")))

    def test_metadata_store_deletes_one_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.json"
            store = services.LoraMetadataStore(str(path))
            store.record_many([
                {
                    "name": "A.safetensors",
                    "sha256": "a" * 64,
                    "size": 123,
                    "trigger_words": ["alpha"],
                    "active_trigger_words": ["alpha"],
                },
                {
                    "name": "B.safetensors",
                    "sha256": "b" * 64,
                    "size": 456,
                    "trigger_words": ["beta"],
                    "active_trigger_words": ["beta"],
                },
            ])

            store.delete("A" * 64)

            self.assertEqual(
                [entry["sha256"] for entry in store.read()["entries"]],
                ["b" * 64],
            )
            with self.assertRaisesRegex(FileNotFoundError, "not found"):
                store.delete("a" * 64)
            with self.assertRaisesRegex(ValueError, "valid SHA-256"):
                store.delete("invalid")
            self.assertFalse(list(path.parent.glob("*.tmp")))

    def test_metadata_store_clear_removes_all_identities_and_trigger_words(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.json"
            store = services.LoraMetadataStore(str(path))
            store.record_many([{
                "name": "A.safetensors",
                "sha256": "a" * 64,
                "size": 123,
                "trigger_words": ["alpha"],
                "active_trigger_words": ["alpha"],
            }])

            self.assertEqual(store.clear(), 1)
            self.assertEqual(store.read(), {"version": 3, "entries": []})
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"version": 3, "entries": {}},
            )
            self.assertEqual(store.clear(), 0)
            self.assertFalse(list(path.parent.glob("*.tmp")))

    def test_metadata_store_migrates_legacy_trigger_word_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.json"
            path.write_text(json.dumps({
                "version": 1,
                "entries": {
                    "a" * 64: {
                        "name": "folder/A.safetensors",
                        "size": 123,
                        "trigger_word": " old trigger ",
                    },
                },
            }), encoding="utf-8")
            store = services.LoraMetadataStore(str(path))
            entry = store.read()["entries"][0]
            self.assertEqual(entry["trigger_words"], ["old trigger"])
            self.assertEqual(entry["active_trigger_words"], ["old trigger"])

            [renamed] = store.record_many([{
                "name": "renamed/A.safetensors",
                "sha256": "a" * 64,
                "size": 123,
            }])
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["version"], 3)
            self.assertNotIn("trigger_word", saved["entries"]["a" * 64])
            self.assertEqual(renamed["trigger_words"], ["old trigger"])

    def test_metadata_store_migrates_v2_active_trigger_word(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.json"
            path.write_text(json.dumps({
                "version": 2,
                "entries": {
                    "a" * 64: {
                        "name": "A.safetensors",
                        "size": 123,
                        "trigger_words": ["one", "two"],
                        "active_trigger_word": "two",
                    },
                },
            }), encoding="utf-8")
            store = services.LoraMetadataStore(str(path))
            entry = store.read()["entries"][0]
            self.assertEqual(entry["trigger_words"], ["one", "two"])
            self.assertEqual(entry["active_trigger_words"], ["two"])

    def test_metadata_store_rejects_invalid_trigger_arrays(self):
        with tempfile.TemporaryDirectory() as directory:
            store = services.LoraMetadataStore(str(Path(directory) / "metadata.json"))
            identity = {
                "name": "A.safetensors",
                "sha256": "a" * 64,
                "size": 123,
            }
            with self.assertRaisesRegex(ValueError, "array of strings"):
                store.set_trigger_words(identity, "not an array")
            with self.assertRaisesRegex(ValueError, "array of strings"):
                store.set_trigger_words(identity, ["valid", 3])
            with self.assertRaisesRegex(ValueError, "selected from"):
                store.set_trigger_words(identity, ["one"], ["missing"])
            with self.assertRaisesRegex(ValueError, "array of strings"):
                store.set_trigger_words(identity, ["one"], "one")
            with self.assertRaisesRegex(ValueError, "cannot exceed"):
                store.set_trigger_words(identity, ["x" * 2001])


if __name__ == "__main__":
    unittest.main()
