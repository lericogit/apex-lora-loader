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
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("loras"), list):
            raise ValueError("Each Apex LoRA section must contain a LoRA list.")
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
            digest, size = validate_identity(entry)
            _, active_trigger_words = normalize_trigger_metadata(entry)
            trigger_position = entry.get("trigger_position", "append")
            if trigger_position not in ("prepend", "append"):
                raise ValueError(
                    f"Trigger position for '{name}' must be prepend or append."
                )
            rows.append({
                "id": entry.get("id"),
                "name": name,
                "enabled": enabled,
                "strength": strength,
                "sha256": digest,
                "size": size,
                "active_trigger_words": active_trigger_words,
                "trigger_position": trigger_position,
            })
    return rows


def augment_prompt(prompt, rows):
    if not isinstance(prompt, str):
        raise ValueError("Apex LoRA prompt must be a string.")
    prepended = []
    appended = []
    for entry in rows:
        if not entry["enabled"] or entry["strength"] == 0:
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

        for entry in rows:
            if not entry["enabled"] or entry["strength"] == 0:
                continue
            resolved = LORA_CATALOG.resolve(entry)
            path = folder_paths.get_full_path_or_raise("loras", resolved["name"])
            if path not in loaded_loras:
                loaded_loras[path] = comfy.utils.load_torch_file(
                    path, safe_load=True, return_metadata=True
                )
            lora, metadata = loaded_loras[path]
            model, _ = comfy.sd.load_lora_for_models(
                model,
                None,
                lora,
                entry["strength"],
                0,
                lora_metadata=metadata,
            )
            if resolved["renamed"]:
                renamed.append({
                    "row_id": entry["id"],
                    "old_name": entry["name"],
                    "name": resolved["name"],
                    "sha256": resolved["sha256"],
                    "size": resolved["size"],
                })

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
