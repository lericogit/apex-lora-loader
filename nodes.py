import json
import logging
import math

import comfy.sd
import comfy.utils
import folder_paths

from server import PromptServer

from .services import (
    LORA_CATALOG,
    normalize_lora_name,
    normalize_trigger_metadata,
    validate_identity,
)


EMPTY_STATE = json.dumps({
    "version": 1,
    "folder_filters": None,
    "active_preset_id": None,
    "sections": [],
}, separators=(",", ":"))


def parse_state(raw_state):
    if not isinstance(raw_state, str):
        raise ValueError("Apex LoRA state must be a JSON string.")
    try:
        state = json.loads(raw_state)
    except json.JSONDecodeError as error:
        raise ValueError("Apex LoRA state contains invalid JSON.") from error
    if not isinstance(state, dict) or state.get("version") != 1:
        raise ValueError("Apex LoRA state has an unsupported version.")
    sections = state.get("sections")
    if not isinstance(sections, list):
        raise ValueError("Apex LoRA state sections must be a list.")

    rows = []
    order = 0
    for section_index, section in enumerate(sections):
        if not isinstance(section, dict) or not isinstance(section.get("loras"), list):
            raise ValueError("Each Apex LoRA section must contain a LoRA list.")
        section_name = section.get("name")
        if not isinstance(section_name, str) or not section_name.strip():
            section_name = f"Section {section_index + 1}"
        else:
            section_name = section_name.strip()
        for entry in section["loras"]:
            if not isinstance(entry, dict):
                raise ValueError("Each Apex LoRA row must be an object.")
            name = normalize_lora_name(entry.get("name"))
            enabled = entry.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError(f"Enabled state for '{name}' must be true or false.")
            strength = entry.get("strength")
            if isinstance(strength, bool) or not isinstance(strength, (int, float)):
                raise ValueError(f"Strength for '{name}' must be numeric.")
            strength = float(strength)
            if not math.isfinite(strength) or strength < -100 or strength > 100:
                raise ValueError(f"Strength for '{name}' must be between -100 and 100.")
            strength = round(strength, 2)
            muted = entry.get("muted", False)
            if not isinstance(muted, bool):
                raise ValueError(f"Muted state for '{name}' must be true or false.")
            digest, size = validate_identity(entry)
            _, active_trigger_words = normalize_trigger_metadata(entry)
            trigger_position = entry.get("trigger_position", "append")
            if trigger_position not in ("prepend", "append"):
                raise ValueError(
                    f"Trigger position for '{name}' must be prepend or append."
                )
            rows.append({
                "order": order,
                "section": section_name,
                "id": entry.get("id"),
                "name": name,
                "enabled": enabled,
                "strength": strength,
                "muted": muted,
                "sha256": digest,
                "size": size,
                "active_trigger_words": active_trigger_words,
                "trigger_position": trigger_position,
            })
            order += 1
    return rows


def effective_strength(entry):
    """Return the strength a row actually contributes.

    The temporary zero override never rewrites the stored strength, so every
    execution path derives its value here instead of reading ``strength``.
    """
    return 0.0 if entry.get("muted") else entry["strength"]


def augment_prompt(prompt, rows):
    if not isinstance(prompt, str):
        raise ValueError("Apex LoRA prompt must be a string.")
    prepended = []
    appended = []
    for entry in rows:
        if not entry["enabled"] or effective_strength(entry) == 0:
            continue
        trigger_words = entry["active_trigger_words"]
        if not trigger_words:
            continue
        target = prepended if entry["trigger_position"] == "prepend" else appended
        target.extend(trigger_words)
    if not prepended and not appended:
        return prompt
    parts = list(prepended)
    if prompt.strip():
        parts.append(prompt.strip())
    parts.extend(appended)
    return ", ".join(parts)


def _model_patch_inventory(model):
    """Return per-key patch contribution counts for a Comfy ModelPatcher.

    ``load_lora_for_models`` deliberately remains the authority for converting
    and installing LoRA patches. Comparing the returned patcher with its input
    lets diagnostics report what that exact core call installed without
    duplicating ComfyUI's LoRA matching logic.
    """
    try:
        patches = getattr(model, "patches", None)
    except Exception:
        return None
    if not isinstance(patches, dict):
        return None
    inventory = {}
    try:
        for key, values in patches.items():
            try:
                inventory[key] = len(values)
            except Exception:
                inventory[key] = 1
    except Exception:
        return None
    return inventory


def _model_patch_delta(before, after):
    if before is None or after is None:
        return None
    try:
        increased = {
            key: count - before.get(key, 0)
            for key, count in after.items()
            if count > before.get(key, 0)
        }
    except Exception:
        return None
    return {
        "keys": len(increased),
        "entries": sum(increased.values()),
    }


def _runtime_row(entry, **extra):
    return {
        "order": entry["order"] + 1,
        "section": entry["section"],
        "requested_name": entry["name"],
        "strength": effective_strength(entry),
        **extra,
    }


def _send_execution_report(report, unique_id):
    applied_count = len(report["applied"])
    unmatched_count = len(report["unmatched"])
    skipped_count = len(report["skipped"])
    failed_count = len(report["failed"])
    logging.info(
        "Apex LoRA Loader%s runtime report: %d applied, %d unmatched, "
        "%d skipped, %d failed.",
        f" node {unique_id}" if unique_id is not None else "",
        applied_count,
        unmatched_count,
        skipped_count,
        failed_count,
    )
    for entry in report["unmatched"]:
        logging.warning(
            "Apex LoRA Loader: LoRA '%s' produced no compatible model patches.",
            entry["resolved_name"],
        )

    prompt_server = getattr(PromptServer, "instance", None)
    client_id = getattr(prompt_server, "client_id", None)
    if unique_id is None or client_id is None:
        return
    try:
        prompt_server.send_sync(
            "apex-lora-loader/execution-report",
            {"node_id": str(unique_id), **report},
            sid=client_id,
        )
    except Exception:
        # Diagnostics must never turn a successful model patch into a failed
        # workflow execution.
        logging.exception("Apex LoRA Loader could not send its runtime report.")


class ApexLoraLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "The diffusion model to patch with the enabled LoRAs."}),
                "stack_data": (
                    "STRING",
                    {
                        "default": EMPTY_STATE,
                        "multiline": True,
                        "tooltip": "Managed by the Apex LoRA Loader interface.",
                    },
                ),
            },
            "optional": {
                "prompt": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Prompt to augment with active trigger words from enabled LoRAs.",
                    },
                ),
                "preset_jobs": (
                    "APEX_PRESET_JOBS",
                    {
                        "tooltip": "Optional control link from Apex Preset Jobs. It does not change LoRA loading during normal execution.",
                    },
                ),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "prompt")
    FUNCTION = "load_loras"
    CATEGORY = "loaders/Apex"
    DESCRIPTION = "Apply an ordered LoRA stack and add its active trigger words to a prompt."

    def load_loras(self, model, stack_data, prompt="", preset_jobs=None, unique_id=None):
        # The companion Preset Jobs node uses this optional input only to identify
        # its target in the frontend. LoRA execution deliberately remains wholly
        # determined by stack_data.
        del preset_jobs
        loaded_loras = {}
        renamed = []
        rows = parse_state(stack_data)
        prompt = augment_prompt(prompt, rows)
        report = {
            "applied": [],
            "unmatched": [],
            "skipped": [],
            "failed": [],
        }

        for entry in rows:
            strength = effective_strength(entry)
            if not entry["enabled"]:
                report["skipped"].append(_runtime_row(entry, reason="Disabled"))
                continue
            if entry["muted"]:
                report["skipped"].append(
                    _runtime_row(entry, reason="Temporary 0.00 override")
                )
                continue
            if strength == 0:
                report["skipped"].append(_runtime_row(entry, reason="Strength is 0.00"))
                continue

            resolved = None
            try:
                resolved = LORA_CATALOG.resolve(entry)
                path = folder_paths.get_full_path_or_raise("loras", resolved["name"])
                reused_file_data = path in loaded_loras
                if not reused_file_data:
                    loaded_loras[path] = comfy.utils.load_torch_file(
                        path, safe_load=True, return_metadata=True
                    )
                lora, metadata = loaded_loras[path]
                before = _model_patch_inventory(model)
                patched_model, _ = comfy.sd.load_lora_for_models(
                    model,
                    None,
                    lora,
                    strength,
                    0,
                    lora_metadata=metadata,
                )
                delta = _model_patch_delta(
                    before,
                    _model_patch_inventory(patched_model),
                )
                model = patched_model
                runtime_entry = _runtime_row(
                    entry,
                    resolved_name=resolved["name"],
                    renamed=resolved["renamed"],
                    source_tensors=len(lora) if isinstance(lora, dict) else None,
                    model_patch_keys=delta["keys"] if delta is not None else None,
                    model_patch_entries=delta["entries"] if delta is not None else None,
                    execution_file_reuse=reused_file_data,
                )
                if delta is not None and delta["entries"] == 0:
                    report["unmatched"].append(runtime_entry)
                else:
                    report["applied"].append(runtime_entry)
                if resolved["renamed"]:
                    renamed.append({
                        "row_id": entry["id"],
                        "old_name": entry["name"],
                        "name": resolved["name"],
                        "sha256": resolved["sha256"],
                        "size": resolved["size"],
                    })
            except Exception as error:
                report["failed"].append(
                    _runtime_row(
                        entry,
                        resolved_name=resolved["name"] if resolved else None,
                        error=f"{type(error).__name__}: {error}",
                    )
                )
                _send_execution_report(report, unique_id)
                raise

        _send_execution_report(report, unique_id)

        prompt_server = getattr(PromptServer, "instance", None)
        client_id = getattr(prompt_server, "client_id", None)
        if renamed and unique_id is not None and client_id is not None:
            logging.info("Apex LoRA Loader resolved %d renamed LoRA(s).", len(renamed))
            prompt_server.send_sync(
                "apex-lora-loader/resolved",
                {"node_id": str(unique_id), "updates": renamed},
                sid=client_id,
            )
        return model, prompt


NODE_CLASS_MAPPINGS = {"ApexLoraLoader": ApexLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"ApexLoraLoader": "Apex LoRA Loader"}
