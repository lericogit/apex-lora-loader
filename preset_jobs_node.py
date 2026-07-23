import json
import math

from .services import normalize_lora_name, validate_identity


JOBS_STATE_VERSION = 1
MAX_JOBS = 2048
MAX_PRESET_ENTRIES = 2048
EMPTY_JOBS_STATE = json.dumps(
    {"version": JOBS_STATE_VERSION, "view": "expanded", "jobs": []},
    separators=(",", ":"),
)


def _validate_entry(entry):
    if not isinstance(entry, dict):
        raise ValueError("Preset job entries must be objects.")
    name = normalize_lora_name(entry.get("name"))
    digest, size = validate_identity(entry)
    strength = entry.get("strength")
    if isinstance(strength, bool) or not isinstance(strength, (int, float)):
        raise ValueError(f"Preset job strength for '{name}' must be numeric.")
    strength = float(strength)
    if not math.isfinite(strength) or strength < -100 or strength > 100:
        raise ValueError(f"Preset job strength for '{name}' must be between -100 and 100.")
    return {
        "name": name,
        "sha256": digest,
        "size": size,
        "strength": round(strength, 2),
    }


def parse_jobs_state(raw_state):
    if not isinstance(raw_state, str):
        raise ValueError("Apex Preset Jobs state must be a JSON string.")
    try:
        state = json.loads(raw_state)
    except json.JSONDecodeError as error:
        raise ValueError("Apex Preset Jobs state contains invalid JSON.") from error
    if not isinstance(state, dict) or state.get("version") != JOBS_STATE_VERSION:
        raise ValueError("Apex Preset Jobs state has an unsupported version.")
    view = state.get("view", "expanded")
    if view not in ("expanded", "grouped"):
        raise ValueError("Apex Preset Jobs view must be expanded or grouped.")
    jobs = state.get("jobs")
    if not isinstance(jobs, list) or len(jobs) > MAX_JOBS:
        raise ValueError(f"Apex Preset Jobs must contain at most {MAX_JOBS} jobs.")

    clean_jobs = []
    seen_ids = set()
    for index, job in enumerate(jobs):
        if not isinstance(job, dict):
            raise ValueError("Apex Preset Jobs entries must be objects.")
        job_id = job.get("id")
        if not isinstance(job_id, str) or not job_id.strip() or job_id in seen_ids:
            raise ValueError("Every Apex Preset Job must have a unique non-empty ID.")
        seen_ids.add(job_id)
        preset = job.get("preset")
        if not isinstance(preset, dict):
            raise ValueError(f"Job {index + 1} must contain a preset snapshot.")
        name = preset.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
            raise ValueError("Preset snapshot names must contain 1 to 100 characters.")
        source_id = preset.get("source_id")
        if source_id is not None and not isinstance(source_id, str):
            raise ValueError("Preset snapshot source IDs must be strings or null.")
        entries = preset.get("entries")
        if not isinstance(entries, list) or len(entries) > MAX_PRESET_ENTRIES:
            raise ValueError(
                f"Preset snapshots must contain at most {MAX_PRESET_ENTRIES} LoRAs."
            )
        clean_jobs.append(
            {
                "id": job_id,
                "preset": {
                    "source_id": source_id,
                    "name": name.strip(),
                    "entries": [_validate_entry(entry) for entry in entries],
                },
            }
        )
    return {"version": JOBS_STATE_VERSION, "view": view, "jobs": clean_jobs}


def parse_run_context(raw_context):
    if raw_context in (None, ""):
        return None
    if not isinstance(raw_context, str) or len(raw_context) > 4096:
        raise ValueError("Apex Preset Jobs run context is invalid.")
    try:
        context = json.loads(raw_context)
    except json.JSONDecodeError as error:
        raise ValueError("Apex Preset Jobs run context contains invalid JSON.") from error
    if not isinstance(context, dict):
        raise ValueError("Apex Preset Jobs run context must be an object.")
    batch_id = context.get("batch_id")
    job_id = context.get("job_id")
    if not isinstance(batch_id, str) or not batch_id or not isinstance(job_id, str) or not job_id:
        raise ValueError("Apex Preset Jobs run context requires batch_id and job_id.")
    return {"batch_id": batch_id, "job_id": job_id}


class ApexPresetJobs:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "jobs_data": (
                    "STRING",
                    {
                        "default": EMPTY_JOBS_STATE,
                        "multiline": True,
                        "tooltip": "Managed by the Apex Preset Jobs interface.",
                    },
                ),
                "run_context": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "Transient queue context managed by Apex Preset Jobs.",
                    },
                ),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("APEX_PRESET_JOBS",)
    RETURN_NAMES = ("preset_jobs",)
    FUNCTION = "control_token"
    CATEGORY = "loaders/Apex"
    DESCRIPTION = "Queue frozen active-state preset snapshots through an Apex LoRA Loader."

    def control_token(self, jobs_data, run_context="", unique_id=None):
        parse_jobs_state(jobs_data)
        context = parse_run_context(run_context)
        return ({
            "node_id": str(unique_id) if unique_id is not None else None,
            "run_context": context,
        },)


NODE_CLASS_MAPPINGS = {"ApexPresetJobs": ApexPresetJobs}
NODE_DISPLAY_NAME_MAPPINGS = {"ApexPresetJobs": "Apex Preset Jobs"}
