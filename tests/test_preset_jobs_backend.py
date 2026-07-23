import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = ROOT.parents[1]
sys.path.insert(0, str(COMFY_ROOT))
PACKAGE = "apex_lora_loader_jobs_tests"


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


load_module("services", "services.py")
jobs = load_module("preset_jobs_node", "preset_jobs_node.py")


def entry(name="a.safetensors", digest=None, strength=1.0):
    return {
        "name": name,
        "sha256": digest or "a" * 64,
        "size": 10,
        "strength": strength,
    }


def state(entries=None, view="expanded"):
    return json.dumps({
        "version": 1,
        "view": view,
        "jobs": [{
            "id": "job-1",
            "preset": {"source_id": "preset-1", "name": "One", "entries": entries or []},
        }],
    })


class PresetJobsBackendTests(unittest.TestCase):
    def test_node_contract_and_defaults(self):
        inputs = jobs.ApexPresetJobs.INPUT_TYPES()
        self.assertEqual(inputs["required"]["jobs_data"][0], "STRING")
        self.assertEqual(inputs["required"]["run_context"][0], "STRING")
        self.assertEqual(jobs.ApexPresetJobs.RETURN_TYPES, ("APEX_PRESET_JOBS",))
        self.assertEqual(jobs.NODE_CLASS_MAPPINGS["ApexPresetJobs"], jobs.ApexPresetJobs)
        self.assertEqual(jobs.parse_jobs_state(jobs.EMPTY_JOBS_STATE)["jobs"], [])

    def test_state_validation_normalizes_entries(self):
        parsed = jobs.parse_jobs_state(state([entry(strength=0.456)]))
        self.assertEqual(parsed["jobs"][0]["preset"]["entries"][0]["strength"], 0.46)
        self.assertEqual(parsed["jobs"][0]["preset"]["entries"][0]["sha256"], "a" * 64)

    def test_state_rejects_duplicate_ids_and_invalid_data(self):
        duplicate = json.loads(state())
        duplicate["jobs"].append(duplicate["jobs"][0])
        with self.assertRaisesRegex(ValueError, "unique"):
            jobs.parse_jobs_state(json.dumps(duplicate))
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            jobs.parse_jobs_state(state([entry(digest="bad")]))
        with self.assertRaisesRegex(ValueError, "between"):
            jobs.parse_jobs_state(state([entry(strength=101)]))
        with self.assertRaisesRegex(ValueError, "view"):
            jobs.parse_jobs_state(state(view="tiles"))

    def test_control_token_is_idle_or_contains_valid_context(self):
        node = jobs.ApexPresetJobs()
        [idle] = node.control_token(state(), unique_id="42")
        self.assertEqual(idle, {"node_id": "42", "run_context": None})
        context = json.dumps({"batch_id": "batch", "job_id": "job-1"})
        [active] = node.control_token(state(), context, unique_id=42)
        self.assertEqual(active["run_context"], {"batch_id": "batch", "job_id": "job-1"})
        with self.assertRaisesRegex(ValueError, "requires"):
            node.control_token(state(), json.dumps({"batch_id": "batch"}))


if __name__ == "__main__":
    unittest.main()
