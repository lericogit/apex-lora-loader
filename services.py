import hashlib
import json
import math
import os
import re
import threading
import uuid
from collections import OrderedDict

import folder_paths


HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
METADATA_VERSION = 3
PRESET_VERSION = 2
TRIGGER_WORD_MAX_LENGTH = 2000


def normalize_lora_name(name):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("LoRA name must be a non-empty string.")
    return name.replace("\\", "/")


def validate_identity(entry):
    digest = entry.get("sha256")
    size = entry.get("size")
    if not isinstance(digest, str) or HASH_PATTERN.fullmatch(digest.lower()) is None:
        raise ValueError(f"LoRA '{entry.get('name', '')}' has no valid SHA-256 identity.")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise ValueError(f"LoRA '{entry.get('name', '')}' has no valid file size.")
    return digest.lower(), size


def normalize_trigger_metadata(entry):
    if "trigger_words" in entry:
        values = entry["trigger_words"]
        if not isinstance(values, list):
            raise ValueError("Trigger words must be an array of strings.")
    else:
        legacy = entry.get("trigger_word", "")
        if not isinstance(legacy, str):
            raise ValueError("Trigger word must be a string.")
        values = [legacy] if legacy.strip() else []

    trigger_words = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            raise ValueError("Trigger words must be an array of strings.")
        word = value.strip()
        if len(word) > TRIGGER_WORD_MAX_LENGTH:
            raise ValueError(f"Trigger words cannot exceed {TRIGGER_WORD_MAX_LENGTH} characters.")
        if not word or word in seen:
            continue
        seen.add(word)
        trigger_words.append(word)

    if "active_trigger_words" in entry:
        active_values = entry["active_trigger_words"]
        if not isinstance(active_values, list):
            raise ValueError("Active trigger words must be an array of strings.")
    elif "active_trigger_word" in entry:
        legacy_active = entry["active_trigger_word"]
        if not isinstance(legacy_active, str):
            raise ValueError("Active trigger word must be a string.")
        active_values = [legacy_active] if legacy_active.strip() else trigger_words[:1]
    elif "trigger_word" in entry:
        legacy_active = entry["trigger_word"]
        if not isinstance(legacy_active, str):
            raise ValueError("Trigger word must be a string.")
        active_values = [legacy_active] if legacy_active.strip() else []
    else:
        active_values = trigger_words[:1]

    active_set = set()
    for value in active_values:
        if not isinstance(value, str):
            raise ValueError("Active trigger words must be an array of strings.")
        active = value.strip()
        if active and active not in seen:
            raise ValueError("Active trigger words must be selected from the saved trigger words.")
        if active:
            active_set.add(active)
    return trigger_words, [word for word in trigger_words if word in active_set]


def _atomic_write_json(path, data):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    temporary = os.path.join(directory, f".{os.path.basename(path)}.{uuid.uuid4().hex}.tmp")
    try:
        with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class LoraCatalog:
    def __init__(self, max_hash_cache=256):
        self.max_hash_cache = max_hash_cache
        self._hash_cache = OrderedDict()
        self._cache_lock = threading.Lock()

    def names(self):
        names = {normalize_lora_name(name) for name in folder_paths.get_filename_list("loras")}
        return sorted(names, key=lambda value: (value.casefold(), value))

    def listing(self):
        names = self.names()
        folders = {""}
        for name in names:
            parts = name.split("/")[:-1]
            for index in range(1, len(parts) + 1):
                folders.add("/".join(parts[:index]))
        return {
            "loras": names,
            "folders": sorted(folders, key=lambda value: (value.casefold(), value)),
        }

    def _path_for_known_name(self, name, known_names=None):
        canonical = normalize_lora_name(name)
        if known_names is None:
            known_names = set(self.names())
        if canonical not in known_names:
            return canonical, None
        return canonical, folder_paths.get_full_path("loras", canonical)

    def _cached_digest(self, path, stat, force=False):
        key = (os.path.realpath(path), stat.st_size, stat.st_mtime_ns)
        if not force:
            with self._cache_lock:
                digest = self._hash_cache.get(key)
                if digest is not None:
                    self._hash_cache.move_to_end(key)
                    return digest

        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
        current_stat = os.stat(path)
        if current_stat.st_size != stat.st_size or current_stat.st_mtime_ns != stat.st_mtime_ns:
            raise RuntimeError(f"LoRA '{os.path.basename(path)}' changed while it was being hashed; retry.")

        value = digest.hexdigest()
        with self._cache_lock:
            self._hash_cache[key] = value
            self._hash_cache.move_to_end(key)
            while len(self._hash_cache) > self.max_hash_cache:
                self._hash_cache.popitem(last=False)
        return value

    def discard_digest(self, digest):
        if not isinstance(digest, str) or HASH_PATTERN.fullmatch(digest.lower()) is None:
            raise ValueError("Cached LoRA identity must be a valid SHA-256 hash.")
        digest = digest.lower()
        with self._cache_lock:
            keys = [key for key, value in self._hash_cache.items() if value == digest]
            for key in keys:
                del self._hash_cache[key]
            return len(keys)

    def clear_hash_cache(self):
        with self._cache_lock:
            deleted = len(self._hash_cache)
            self._hash_cache.clear()
            return deleted

    def identify(self, name, force=False, known_names=None):
        canonical, path = self._path_for_known_name(name, known_names)
        if path is None:
            raise FileNotFoundError(f"LoRA '{canonical}' was not found in the configured LoRA folders.")
        stat = os.stat(path)
        return {
            "name": canonical,
            "sha256": self._cached_digest(path, stat, force=force),
            "size": stat.st_size,
            "path": path,
        }

    def resolve(self, entry, identify_existing=False, force=False):
        if not isinstance(entry, dict):
            raise ValueError("LoRA entry must be an object.")
        name = normalize_lora_name(entry.get("name"))
        known_names = set(self.names())
        canonical, path = self._path_for_known_name(name, known_names)
        if path is not None:
            try:
                validate_identity(entry)
                has_identity = True
            except ValueError:
                has_identity = False
            if identify_existing or not has_identity:
                identity = self.identify(canonical, force=force, known_names=known_names)
            else:
                identity = {
                    "name": canonical,
                    "sha256": entry.get("sha256"),
                    "size": entry.get("size"),
                    "path": path,
                }
            identity["renamed"] = False
            return identity

        digest, size = validate_identity(entry)
        matches = []
        for candidate in known_names:
            candidate_path = folder_paths.get_full_path("loras", candidate)
            if candidate_path is None:
                continue
            stat = os.stat(candidate_path)
            if stat.st_size != size:
                continue
            identity = self.identify(candidate, force=force, known_names=known_names)
            if identity["sha256"] == digest:
                matches.append(identity)

        if not matches:
            raise FileNotFoundError(
                f"LoRA '{name}' is missing and no file matches its stored SHA-256 identity."
            )
        matches.sort(key=lambda item: (item["name"].casefold(), item["name"]))
        match = matches[0]
        match["renamed"] = match["name"] != name
        match["alternatives"] = len(matches) - 1
        return match


class LoraMetadataStore:
    def __init__(self, path=None):
        if path is None:
            path = os.path.join(
                folder_paths.get_system_user_directory("apex_lora_loader"), "lora_metadata.json"
            )
        self.path = path
        self._lock = threading.RLock()

    def _read_unlocked(self):
        if not os.path.isfile(self.path):
            return {"version": METADATA_VERSION, "entries": {}}
        with open(self.path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if (
            not isinstance(data, dict)
            or data.get("version") not in (1, 2, METADATA_VERSION)
            or not isinstance(data.get("entries"), dict)
        ):
            raise ValueError("Apex LoRA metadata file has an unsupported format.")
        clean = {}
        for digest, entry in data["entries"].items():
            if not isinstance(digest, str) or HASH_PATTERN.fullmatch(digest.lower()) is None or not isinstance(entry, dict):
                raise ValueError("Apex LoRA metadata contains an invalid identity.")
            name = normalize_lora_name(entry.get("name"))
            size = entry.get("size")
            if isinstance(size, bool) or not isinstance(size, int) or size < 0:
                raise ValueError(f"Apex LoRA metadata for '{name}' has an invalid file size.")
            try:
                trigger_words, active_trigger_words = normalize_trigger_metadata(entry)
            except ValueError as error:
                raise ValueError(f"Apex LoRA metadata for '{name}' is invalid: {error}") from error
            clean[digest.lower()] = {
                "name": name,
                "size": size,
                "trigger_words": trigger_words,
                "active_trigger_words": active_trigger_words,
            }
        return {
            "version": METADATA_VERSION,
            "entries": clean,
            "_needs_write": data.get("version") != METADATA_VERSION,
        }

    @staticmethod
    def _public_entry(digest, entry):
        return {
            "sha256": digest,
            "name": entry["name"],
            "size": entry["size"],
            "trigger_words": list(entry.get("trigger_words", [])),
            "active_trigger_words": list(entry.get("active_trigger_words", [])),
        }

    def _record_unlocked(self, data, identity):
        digest, size = validate_identity(identity)
        name = normalize_lora_name(identity.get("name"))
        existing = data["entries"].get(digest)
        if existing is None:
            trigger_words, active_trigger_words = normalize_trigger_metadata(identity)
        else:
            trigger_words = list(existing["trigger_words"])
            active_trigger_words = list(existing["active_trigger_words"])
        updated = {
            "name": name,
            "size": size,
            "trigger_words": trigger_words,
            "active_trigger_words": active_trigger_words,
        }
        changed = existing != updated
        data["entries"][digest] = updated
        return self._public_entry(digest, updated), changed

    def record_many(self, identities):
        with self._lock:
            data = self._read_unlocked()
            entries = []
            changed = data.pop("_needs_write", False)
            for identity in identities:
                entry, entry_changed = self._record_unlocked(data, identity)
                entries.append(entry)
                changed = changed or entry_changed
            if changed:
                _atomic_write_json(self.path, data)
            return entries

    def set_trigger_words(self, identity, trigger_words, active_trigger_words=None):
        normalized_words, normalized_active = normalize_trigger_metadata({
            "trigger_words": trigger_words,
            "active_trigger_words": active_trigger_words if active_trigger_words is not None else [],
        })
        with self._lock:
            data = self._read_unlocked()
            changed = data.pop("_needs_write", False)
            entry, entry_changed = self._record_unlocked(data, identity)
            changed = changed or entry_changed
            stored = data["entries"][entry["sha256"]]
            changed = changed or stored["trigger_words"] != normalized_words
            changed = changed or stored["active_trigger_words"] != normalized_active
            stored["trigger_words"] = normalized_words
            stored["active_trigger_words"] = normalized_active
            if changed:
                _atomic_write_json(self.path, data)
            return self._public_entry(entry["sha256"], stored)

    def delete(self, digest):
        if not isinstance(digest, str) or HASH_PATTERN.fullmatch(digest.lower()) is None:
            raise ValueError("LoRA metadata identity must be a valid SHA-256 hash.")
        digest = digest.lower()
        with self._lock:
            data = self._read_unlocked()
            data.pop("_needs_write", None)
            if digest not in data["entries"]:
                raise FileNotFoundError("LoRA metadata was not found.")
            del data["entries"][digest]
            _atomic_write_json(self.path, data)

    def clear(self):
        with self._lock:
            data = self._read_unlocked()
            changed = data.pop("_needs_write", False)
            deleted = len(data["entries"])
            if deleted or changed:
                data["entries"] = {}
                _atomic_write_json(self.path, data)
            return deleted

    def read(self):
        with self._lock:
            data = self._read_unlocked()
            entries = [
                self._public_entry(digest, entry)
                for digest, entry in data["entries"].items()
            ]
        entries.sort(key=lambda item: (item["name"].casefold(), item["name"], item["sha256"]))
        return {"version": METADATA_VERSION, "entries": entries}


class PresetStore:
    def __init__(self, path=None):
        if path is None:
            path = os.path.join(
                folder_paths.get_system_user_directory("apex_lora_loader"), "presets.json"
            )
        self.path = path
        self._lock = threading.RLock()

    def _read_unlocked(self):
        if not os.path.isfile(self.path):
            return {"version": PRESET_VERSION, "presets": []}
        with open(self.path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if (
            not isinstance(data, dict)
            or data.get("version") not in (1, PRESET_VERSION)
            or not isinstance(data.get("presets"), list)
        ):
            raise ValueError("Apex LoRA preset file has an unsupported format.")
        presets = [self._validate_preset(preset) for preset in data["presets"]]
        presets.sort(key=lambda item: (item["name"].casefold(), item["name"]))
        return {"version": PRESET_VERSION, "presets": presets}

    def read(self):
        with self._lock:
            return self._read_unlocked()

    def _write_unlocked(self, data):
        _atomic_write_json(self.path, data)

    def _validate_preset(self, preset):
        if not isinstance(preset, dict):
            raise ValueError("Preset must be an object.")
        preset_id = preset.get("id") or str(uuid.uuid4())
        try:
            preset_id = str(uuid.UUID(preset_id))
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError("Preset id must be a UUID.") from error
        name = preset.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Preset name cannot be empty.")
        name = name.strip()
        if len(name) > 100:
            raise ValueError("Preset name cannot exceed 100 characters.")

        preset_type = preset.get("type", "active")
        if preset_type not in ("active", "full"):
            raise ValueError("Preset type must be active or full.")
        if preset_type == "full":
            return {
                "id": preset_id,
                "name": name,
                "type": preset_type,
                "state": self._validate_full_state(preset.get("state")),
            }

        entries = preset.get("entries")
        if not isinstance(entries, list) or len(entries) > 2048:
            raise ValueError("Preset entries must be a list of at most 2048 items.")

        clean_entries = []
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Preset entries must be objects.")
            entry_name = normalize_lora_name(entry.get("name"))
            digest, size = validate_identity(entry)
            strength = entry.get("strength")
            if isinstance(strength, bool) or not isinstance(strength, (int, float)):
                raise ValueError(f"Preset strength for '{entry_name}' must be numeric.")
            strength = float(strength)
            if not math.isfinite(strength) or strength < -100 or strength > 100:
                raise ValueError(f"Preset strength for '{entry_name}' must be between -100 and 100.")
            strength = round(strength, 2)
            clean_entries.append({
                "name": entry_name,
                "sha256": digest,
                "size": size,
                "strength": strength,
            })
        return {
            "id": preset_id,
            "name": name,
            "type": preset_type,
            "entries": clean_entries,
        }

    def _validate_full_state(self, state):
        if not isinstance(state, dict) or state.get("version") != 1:
            raise ValueError("Full preset state has an unsupported format.")

        folder_filters = state.get("folder_filters")
        if folder_filters is not None:
            if not isinstance(folder_filters, list) or len(folder_filters) > 256:
                raise ValueError("Full preset folder filters must be null or an array of at most 256 folders.")
            clean_filters = []
            for folder in folder_filters:
                if not isinstance(folder, str):
                    raise ValueError("Full preset folder filters must be strings.")
                folder = folder.replace("\\", "/")
                if folder not in clean_filters:
                    clean_filters.append(folder)
            folder_filters = clean_filters

        settings = state.get("settings", {})
        if not isinstance(settings, dict):
            raise ValueError("Full preset settings must be an object.")
        drag_step = settings.get("strength_drag_step", 0.01)
        if isinstance(drag_step, bool) or not isinstance(drag_step, (int, float)):
            raise ValueError("Full preset strength drag step must be numeric.")
        drag_step = float(drag_step)
        if not math.isfinite(drag_step) or drag_step < 0.01 or drag_step > 100:
            raise ValueError("Full preset strength drag step must be between 0.01 and 100.")
        clean_settings = {
            "show_safetensors": settings.get("show_safetensors") is not False,
            "show_folder_paths": settings.get("show_folder_paths") is not False,
            "show_trigger_button": settings.get("show_trigger_button") is True,
            "strength_drag_step": round(drag_step, 2),
        }

        sections = state.get("sections")
        if not isinstance(sections, list) or not sections or len(sections) > 256:
            raise ValueError("Full preset sections must be a list of 1 to 256 items.")
        clean_sections = []
        section_ids = set()
        row_ids = set()
        row_count = 0
        for section_index, section in enumerate(sections):
            if not isinstance(section, dict):
                raise ValueError("Full preset sections must be objects.")
            section_id = self._validate_item_id(section.get("id"), "Section", section_ids)
            section_name = section.get("name")
            if not isinstance(section_name, str) or not section_name.strip():
                raise ValueError(f"Full preset section {section_index + 1} must have a name.")
            section_name = section_name.strip()
            if len(section_name) > 200:
                raise ValueError("Full preset section names cannot exceed 200 characters.")
            collapsed = section.get("collapsed")
            if not isinstance(collapsed, bool):
                raise ValueError(f"Collapsed state for section '{section_name}' must be true or false.")
            column = section.get("column")
            if column is not None and (
                isinstance(column, bool) or not isinstance(column, int) or column < 0
            ):
                raise ValueError(f"Column for section '{section_name}' must be null or a non-negative integer.")
            loras = section.get("loras")
            if not isinstance(loras, list):
                raise ValueError(f"Section '{section_name}' must contain a LoRA list.")
            row_count += len(loras)
            if row_count > 2048:
                raise ValueError("Full preset state cannot contain more than 2048 LoRAs.")
            clean_loras = [self._validate_full_row(row, row_ids) for row in loras]
            clean_sections.append({
                "id": section_id,
                "name": section_name,
                "collapsed": collapsed,
                "column": column,
                "loras": clean_loras,
            })

        return {
            "version": 1,
            "folder_filters": folder_filters,
            "settings": clean_settings,
            "sections": clean_sections,
        }

    @staticmethod
    def _validate_item_id(value, label, used):
        if not isinstance(value, str) or not value.strip() or len(value) > 200:
            raise ValueError(f"{label} id must be a non-empty string of at most 200 characters.")
        if value in used:
            raise ValueError(f"{label} ids must be unique within a full preset.")
        used.add(value)
        return value

    def _validate_full_row(self, row, row_ids):
        if not isinstance(row, dict):
            raise ValueError("Full preset LoRA rows must be objects.")
        row_id = self._validate_item_id(row.get("id"), "LoRA row", row_ids)
        name = normalize_lora_name(row.get("name"))
        enabled = row.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError(f"Enabled state for '{name}' must be true or false.")
        strength = row.get("strength")
        if isinstance(strength, bool) or not isinstance(strength, (int, float)):
            raise ValueError(f"Preset strength for '{name}' must be numeric.")
        strength = float(strength)
        if not math.isfinite(strength) or strength < -100 or strength > 100:
            raise ValueError(f"Preset strength for '{name}' must be between -100 and 100.")
        digest, size = validate_identity(row)
        trigger_words, active_trigger_words = normalize_trigger_metadata(row)
        trigger_position = row.get("trigger_position", "append")
        if trigger_position not in ("prepend", "append"):
            raise ValueError(f"Trigger position for '{name}' must be prepend or append.")
        return {
            "id": row_id,
            "name": name,
            "enabled": enabled,
            "strength": round(strength, 2),
            "sha256": digest,
            "size": size,
            "trigger_words": trigger_words,
            "active_trigger_words": active_trigger_words,
            "trigger_position": trigger_position,
        }

    def upsert(self, preset):
        clean = self._validate_preset(preset)
        with self._lock:
            data = self._read_unlocked()
            conflict = next(
                (
                    item for item in data["presets"]
                    if item.get("name", "").casefold() == clean["name"].casefold()
                    and item.get("id") != clean["id"]
                ),
                None,
            )
            if conflict is not None:
                raise FileExistsError(f"A preset named '{clean['name']}' already exists.")
            index = next(
                (index for index, item in enumerate(data["presets"]) if item.get("id") == clean["id"]),
                None,
            )
            if index is None:
                data["presets"].append(clean)
            else:
                data["presets"][index] = clean
            data["presets"].sort(key=lambda item: (item["name"].casefold(), item["name"]))
            self._write_unlocked(data)
            return clean

    def rename(self, preset_id, name):
        with self._lock:
            data = self._read_unlocked()
            preset = next((item for item in data["presets"] if item.get("id") == preset_id), None)
            if preset is None:
                raise FileNotFoundError("Preset was not found.")
            updated = dict(preset)
            updated["name"] = name
            return self.upsert(updated)

    def delete(self, preset_id):
        with self._lock:
            data = self._read_unlocked()
            remaining = [item for item in data["presets"] if item.get("id") != preset_id]
            if len(remaining) == len(data["presets"]):
                raise FileNotFoundError("Preset was not found.")
            data["presets"] = remaining
            self._write_unlocked(data)


LORA_CATALOG = LoraCatalog()
LORA_METADATA_STORE = LoraMetadataStore()
PRESET_STORE = PresetStore()
