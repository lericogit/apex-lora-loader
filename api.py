import asyncio
import json

from aiohttp import web
from server import PromptServer

from .services import LORA_CATALOG, LORA_METADATA_STORE, PRESET_STORE


routes = PromptServer.instance.routes


def error_response(error, status=400):
    return web.json_response({"error": str(error)}, status=status)


@routes.get("/apex_lora_loader/loras")
async def list_loras(_request):
    listing = await asyncio.to_thread(LORA_CATALOG.listing)
    return web.json_response(listing)


@routes.post("/apex_lora_loader/identify")
async def identify_loras(request):
    try:
        data = await request.json()
        names = data.get("names")
        if not isinstance(names, list) or len(names) > 512:
            raise ValueError("names must be a list of at most 512 LoRA names.")
        force = data.get("force", False) is True
        def identify_all():
            identities = [LORA_CATALOG.identify(name, force=force) for name in names]
            return LORA_METADATA_STORE.record_many(identities)

        identities = await asyncio.to_thread(identify_all)
        return web.json_response({"entries": identities})
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return error_response(error)
    except FileNotFoundError as error:
        return error_response(error, 404)


@routes.post("/apex_lora_loader/resolve")
async def resolve_loras(request):
    try:
        data = await request.json()
        entries = data.get("entries")
        if not isinstance(entries, list) or len(entries) > 512:
            raise ValueError("entries must be a list of at most 512 LoRA rows.")
        force = data.get("force", False) is True

        def resolve_all():
            resolved = []
            errors = []
            for entry in entries:
                try:
                    identity = LORA_CATALOG.resolve(
                        entry, identify_existing=force, force=force
                    )
                    resolved_entry = {
                        "id": entry.get("id"),
                        **{key: value for key, value in identity.items() if key != "path"},
                    }
                    if "trigger_words" in entry:
                        resolved_entry["trigger_words"] = entry["trigger_words"]
                        if "active_trigger_words" in entry:
                            resolved_entry["active_trigger_words"] = entry["active_trigger_words"]
                        elif "active_trigger_word" in entry:
                            resolved_entry["active_trigger_word"] = entry["active_trigger_word"]
                    elif isinstance(entry.get("trigger_word"), str):
                        resolved_entry["trigger_word"] = entry["trigger_word"]
                    resolved.append(resolved_entry)
                except (FileNotFoundError, RuntimeError, TypeError, ValueError) as error:
                    errors.append({
                        "id": entry.get("id") if isinstance(entry, dict) else None,
                        "name": entry.get("name") if isinstance(entry, dict) else None,
                        "error": str(error),
                    })
            metadata = LORA_METADATA_STORE.record_many(resolved)
            for entry, saved in zip(resolved, metadata):
                entry.pop("trigger_word", None)
                entry.pop("active_trigger_word", None)
                entry["trigger_words"] = saved["trigger_words"]
                entry["active_trigger_words"] = saved["active_trigger_words"]
            return resolved, errors

        resolved, errors = await asyncio.to_thread(resolve_all)
        return web.json_response({"entries": resolved, "errors": errors})
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return error_response(error)


@routes.get("/apex_lora_loader/metadata")
async def list_lora_metadata(_request):
    data = await asyncio.to_thread(LORA_METADATA_STORE.read)
    return web.json_response(data)


@routes.put("/apex_lora_loader/metadata/{sha256}")
async def save_lora_trigger_words(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("LoRA metadata must be an object.")
        identity = {
            "name": data.get("name"),
            "sha256": request.match_info["sha256"],
            "size": data.get("size"),
        }
        if "trigger_words" in data:
            trigger_words = data.get("trigger_words")
        else:
            trigger_word = data.get("trigger_word")
            trigger_words = [trigger_word] if isinstance(trigger_word, str) and trigger_word.strip() else []
        if "active_trigger_words" in data:
            active_trigger_words = data.get("active_trigger_words")
        elif isinstance(data.get("active_trigger_word"), str):
            active_trigger_word = data["active_trigger_word"].strip()
            active_trigger_words = [active_trigger_word] if active_trigger_word else []
        else:
            trigger_word = data.get("trigger_word")
            active_trigger_words = [trigger_word] if isinstance(trigger_word, str) and trigger_word.strip() else []
        saved = await asyncio.to_thread(
            LORA_METADATA_STORE.set_trigger_words,
            identity,
            trigger_words,
            active_trigger_words,
        )
        return web.json_response(saved)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return error_response(error)


@routes.delete("/apex_lora_loader/metadata/{sha256}")
async def delete_lora_metadata(request):
    try:
        digest = request.match_info["sha256"]
        def delete_metadata():
            LORA_METADATA_STORE.delete(digest)
            LORA_CATALOG.discard_digest(digest)

        await asyncio.to_thread(delete_metadata)
        return web.json_response({"deleted": digest.lower()})
    except (TypeError, ValueError) as error:
        return error_response(error)
    except FileNotFoundError as error:
        return error_response(error, 404)


@routes.delete("/apex_lora_loader/metadata")
async def clear_lora_metadata(_request):
    def clear_metadata():
        deleted = LORA_METADATA_STORE.clear()
        LORA_CATALOG.clear_hash_cache()
        return deleted

    deleted = await asyncio.to_thread(clear_metadata)
    return web.json_response({"deleted": deleted})


@routes.get("/apex_lora_loader/presets")
async def list_presets(_request):
    data = await asyncio.to_thread(PRESET_STORE.read)
    return web.json_response(data)


@routes.post("/apex_lora_loader/presets")
async def save_preset(request):
    try:
        preset = await request.json()
        saved = await asyncio.to_thread(PRESET_STORE.upsert, preset)
        return web.json_response(saved)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return error_response(error)
    except FileExistsError as error:
        return error_response(error, 409)


@routes.patch("/apex_lora_loader/presets/{preset_id}")
async def rename_preset(request):
    try:
        data = await request.json()
        renamed = await asyncio.to_thread(
            PRESET_STORE.rename, request.match_info["preset_id"], data.get("name")
        )
        return web.json_response(renamed)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return error_response(error)
    except FileExistsError as error:
        return error_response(error, 409)
    except FileNotFoundError as error:
        return error_response(error, 404)


@routes.delete("/apex_lora_loader/presets/{preset_id}")
async def delete_preset(request):
    try:
        await asyncio.to_thread(PRESET_STORE.delete, request.match_info["preset_id"])
        return web.json_response({"deleted": request.match_info["preset_id"]})
    except FileNotFoundError as error:
        return error_response(error, 404)
