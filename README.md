<div align="center">

# Apex LoRA Loader

### A responsive, sectioned LoRA workspace for ComfyUI

Organize, filter, reorder, preset, recover, and annotate large LoRA stacks in one compact node.

[![License: MIT][license-shield]][license-link]
[![Version: v0.4.1][version-shield]][version-link]
[![ComfyUI Custom Node][comfyui-shield]][comfyui-link]
[![Local only][local-shield]][local-link]
[![No extra packages][dependencies-shield]][dependencies-link]

</div>

<p align="center">
  <img src="docs/images/apex_lora_loader_img_1.png" alt="Apex LoRA Loader with responsive columns, compact LoRA rows, toolbar islands, and an Add Section area" width="100%">
  <br>
  <sub>A responsive LoRA workspace with manual columns, compact controls, live stack information, and an intentional dark interface.</sub>
</p>

> [!NOTE]
> **Fully vibe coded.** Product direction, testing, and iteration were human-led; the implementation was produced with OpenAI Codex.

## Overview

Apex LoRA Loader provides MODEL-only LoRA patching with an optional prompt passthrough. It combines an ordered LoRA stack, responsive named sections, per-node folder filtering, optional per-section folder synchronization, active-state and full-setup presets, rename-safe file identities, and manually curated trigger words. The optional **Apex Preset Jobs** companion queues ordered experiments from frozen active-preset snapshots without replacing the loader's visible setup.

| Port | Direction | Purpose |
| --- | --- | --- |
| `model` | Input | Diffusion model to patch with enabled LoRAs. |
| `prompt` | Optional input | Prompt to augment with active trigger words. |
| `preset_jobs` | Optional input | Control connection from an Apex Preset Jobs companion. Ignored during ordinary LoRA loading. |
| `model` | Output | Model patched in visual section and row order. |
| `prompt` | Output | Prompt with selected trigger words prepended or appended. |

The node intentionally has no CLIP socket. LoRAs are applied to `MODEL` with zero CLIP strength.

---

## Features

- Compact LoRA rows with enable toggles, searchable selection, strength control, trigger metadata, and removal.
- Named, collapsible, draggable sections with cross-section row reordering.
- Responsive manual section columns with stable placement and independent vertical stacking.
- A polished dark interface with split toolbar islands, responsive stack metrics, and a subtle blue-teal fog surface.
- Recursive per-node folder filters with All, None, Root, and multi-folder selection.
- Add-only per-section folder sync with recursive rules, Mirror and New-only modes, optional automatic syncing, ignored identities, and rename-safe verification.
- Native ComfyUI node-definition refresh support for fast LoRA filename and folder discovery.
- Confirmed **Add all LoRAs** action for the current filtered library.
- Installation-wide presets for either active LoRA states or complete node setups, with direct inline management from the custom preset menu.
- An independent Preset Jobs companion for ordered, repeatable multi-preset queue runs with live results.
- SHA-256 identities that recover LoRAs after file or folder renames.
- Multiple active trigger words per LoRA with per-row prepend or append placement.
- Two-decimal strengths and configurable horizontal drag increments.
- Local-only storage, atomic JSON writes, and no persistent tensor cache.

### Stack and sections

Each LoRA occupies one compact row containing a drag handle, enable toggle, searchable chooser, strength input, optional trigger-word control, and remove action.

Sections have stable identities, editable names, enabled counts, collapse controls, one-click all/none toggles, and guarded deletion. Drag sections vertically within a column or horizontally between columns. LoRA rows can be reordered or moved between sections, with a visible insertion marker across the full drop area. Visual order is also execution order: columns run left to right, and each column runs top to bottom.

When the node becomes wider, Apex creates additional section columns. Each column is an independent vertical stack, so differently sized sections sit directly beneath their own neighbors without forcing matching grid rows. Section placement remains under your control instead of being automatically rebalanced. When the node narrows, unavailable preferred columns merge into the final visible column in deterministic order and return when space is available again.

The section width limits and gap are exposed as CSS variables near the top of `web/apex_lora_loader.css` for easy tuning. Lane membership changes only at responsive column breakpoints; section heights and overall stack height are handled by the browser.

New sections are created from the large Add section area directly beneath the final section in a column. It appears only while hovering over available column space and never reserves extra scroll height while hidden. The toolbar remains fixed while the stack uses the remaining node height and scrolls only when its visible content requires it.

The toolbar is divided into compact control islands for presets, live section/LoRA counts, and library utilities. The information island disappears automatically when the node is too narrow, leaving the functional controls uncluttered.

<p align="center">
  <img src="docs/images/add_section_loras.gif" alt="Creating a new Apex section and adding LoRAs to it" width="90%">
  <br>
  <sub>Create a section in its intended column, then add individual or filtered LoRAs without leaving the node.</sub>
</p>

<p align="center">
  <img src="docs/images/drag_and_drop.gif" alt="Dragging Apex LoRA sections and rows within and between columns" width="90%">
  <br>
  <sub>Reorder sections and LoRA rows with clear insertion targets, including moves between sections and columns.</sub>
</p>

### Folder filtering and LoRA selection

Folder filters are stored per node and affect only the chooser:

- **All** shows every LoRA known to ComfyUI.
- **None** shows no chooser entries.
- **Root** shows files directly inside the LoRA root.
- Any number of nested folders can be selected recursively.

Existing rows keep loading even if their folders are later excluded from the chooser. **Add all LoRAs** adds every currently offered LoRA that is not already in the destination section after confirming the exact count and section name.

### Per-section folder sync

Each section can optionally link to one or more recursive LoRA folders from the Folder Sync control beside **Add all LoRAs**. Linked folders are intersected with the node-wide picker filters, while temporarily unavailable rules remain stored for later reuse.

- **Folder mirror** offers every eligible catalog file missing from that section.
- **New LoRAs only** captures the current eligible files as a baseline and offers only files discovered afterward.
- **Off** pauses detection without discarding folder rules, the baseline, or Ignored LoRAs.

Detection is event-driven through workflow loading, native ComfyUI refresh, Apex's advanced rescan, and relevant stack changes—there is no polling or background hashing. A count badge appears on the section add button when files are ready. **Sync** verifies identities lazily, recovers renamed rows where possible, appends verified files in deterministic order, and leaves every new row disabled.

Enable **Auto Sync** beside the Sync action to perform that same verified add-only operation after workflow restoration, native ComfyUI refreshes, and Apex advanced rescans. Automatic additions remain disabled, never trigger Run on Change, produce an aggregated native ComfyUI toast summary, and leave a temporary teal `+N` badge on the affected section until its Add LoRA control is opened. Sections awaiting manual synchronization use an amber count badge and are combined into one detection toast with their section names.

Synchronization is deliberately add-only. Removing, replacing, or moving a linked row records its former identity under **Ignored LoRAs**, preventing the section from immediately restoring it. Pending files can also be ignored directly, and **Allow again** makes an ignored entry eligible once more. Individual verification failures remain listed without blocking successful files.

<p align="center">
  <img src="docs/images/apex_lora_loader_img_3.png" alt="Recursive Apex LoRA folder selector with multiple selected folders" width="72%">
  <br>
  <sub>Select one or more recursive folder branches for each node's LoRA chooser.</sub>
</p>

### Strength control

Strengths are clamped to `-100..100` and stored with at most two decimal places.

Displayed values always use a fixed comma-decimal format such as `1,00`, `1,50`, or `-0,57`. Manual entry accepts either a comma or period as the decimal separator.

The strength field visualizes the decimal portion as a continuous fill and the whole-number magnitude as a second ten-block layer. Positive and negative values use mirrored directions and separate colors; the block layer caps at ten while larger values retain their fractional fill.

- Click and type an exact value.
- Hold the left mouse button and drag horizontally.
- Configure the drag step from `0.01` to `100`, also limited to two decimals.

### Smart global presets

Presets are shared by every Apex node and workflow in the same ComfyUI installation. The save dialog offers two preset types, kept in separate groups in the custom toolbar menu:

- **Active LoRAs** stores only enabled LoRA identities and strengths. Applying one disables current rows, matches saved identities to rows already in the stack, and restores the matching states without changing sections, rows, or ordering.
- **Full setup** stores folder filters, section folder-sync rules and baselines, node settings, sections, columns, collapse states, every LoRA row and its order, enabled states, strengths, and trigger-word configuration. Applying one first warns that the current setup will be replaced.

Active LoRA matching prefers SHA-256, with exact-name fallback for entries without a usable hash. Duplicate LoRAs match one-to-one in current row order, missing entries are reported but never added, and empty presets are valid. Both preset types can be overwritten, renamed inline, or deleted directly from the menu without first applying them.

### Preset Jobs

**Apex Preset Jobs** is an optional companion node for queueing several active LoRA combinations in one action. Connect its `preset_jobs` output to the loader's optional input, add active-state presets to the ordered list, then use **Queue jobs** from the helper.

- Every row represents one normal ComfyUI prompt submission.
- Jobs can be duplicated and rearranged with forgiving full-row drag targets.
- Expanded view shows individual runs; grouped view condenses adjacent identical jobs into an adjustable `×N` count without changing their order.
- Adding a preset creates a frozen snapshot of its enabled LoRA identities and strengths. Later renaming, editing, or deleting the global preset does not rewrite saved jobs.
- Each snapshot applies to the connected loader's current rows. Sections, ordering, filters, settings, and trigger-word configuration remain intact.
- Missing stack entries or unresolved LoRA files skip only the affected jobs and show their reasons.
- Live row states distinguish skipped, queued, running, completed, failed, interrupted, and unsubmitted jobs for the current browser session.

The helper temporarily substitutes only the loader's hidden serialized state while ComfyUI converts each prompt. The loader interface never visually switches presets and its saved setup is restored immediately. ComfyUI's standard Queue button still performs one ordinary run with the current loader state; batching starts only from **Queue jobs**.

Preset Jobs uses ComfyUI's normal per-prompt queue path. Existing seed controls therefore behave normally for every job: fixed seeds remain fixed, while randomize, increment, and decrement modes advance once per submitted run. ComfyUI's global queue-count value is intentionally ignored by the helper because repetitions are represented directly in its job list.

<p align="center">
  <img src="docs/images/apex_preset_jobs_img_1.png" alt="Apex Preset Jobs with an ordered list of ready preset runs, duplication controls, grouping, and queue action" width="72%">
  <br>
  <sub>Build an ordered queue from frozen active presets, duplicate or rearrange jobs, and monitor each run individually.</sub>
</p>

### Rename-safe identities

When a LoRA is selected, Apex records its canonical relative path, file size, and SHA-256 digest. If the exact path later disappears, same-size files are checked for the stored digest. A content match updates the row to its new canonical path; changed contents are treated as a different LoRA.

Exact existing paths always win, and identical duplicate files resolve deterministically. The hash cache contains only a bounded set of digest strings keyed by path, size, and modification time.

ComfyUI's native **Refresh Node Definitions** action refreshes Apex's lightweight filename and folder catalog, so newly added LoRAs appear in choosers without identity analysis. Apex's own refresh button remains the explicit advanced rescan for rename recovery, hashes, and saved metadata verification.

### Trigger words and prompt routing

Trigger words are optional local metadata and are never written into a LoRA file. Each LoRA identity can store an ordered array of words or phrases, with zero, one, or several active entries.

The tag popup provides selectable chips, removal controls, and a field for adding new entries. Active words can be configured per row to:

- **Prepend** before the incoming prompt.
- **Append** after the incoming prompt.

Only enabled rows with nonzero strength contribute trigger words. Words follow visual row order and pass through unchanged when none are active. Trigger metadata is keyed by SHA-256, so it survives filename and folder changes.

The row tag button is hidden by default and can be enabled in Settings.

<p align="center">
  <img src="docs/images/trigger_word.gif" alt="Editing and selecting multiple trigger words for an Apex LoRA row" width="82%">
  <br>
  <sub>Add, remove, and independently activate trigger words, then place them before or after the incoming prompt.</sub>
</p>

### Settings

The compact settings popup provides per-node controls for:

- Showing or hiding the `.safetensors` extension.
- Showing full relative paths or only LoRA filenames.
- Showing or hiding trigger-word buttons.
- Setting the strength drag increment.
- Previewing saved hashes and trigger-word metadata.
- Deleting individual saved identity records directly from the metadata list.
- Clearing all saved identities and trigger words through a guarded danger action.

<p align="center">
  <img src="docs/images/apex_lora_loader_img_2.png" alt="Apex node settings with display controls, strength step, saved LoRA data, and guarded clearing" width="60%">
  <br>
  <sub>Per-node display and strength controls alongside local identity and trigger-word data management.</sub>
</p>

---

## Installation

From the ComfyUI directory:

~~~bash
cd custom_nodes
git clone https://github.com/lericogit/apex-lora-loader.git
~~~

Restart ComfyUI, hard-refresh the browser, then add **Apex LoRA Loader** from `loaders/Apex`. The optional **Apex Preset Jobs** companion is available in the same category.

No `pip install` or `npm install` step is required.

## Quick start

1. Connect a `MODEL` input.
2. Add or rename a section.
3. Select a LoRA with the section's plus button, or configure **Folders** first.
4. Enable rows and set their strengths.
5. Drag rows or sections into the desired application order.
6. Optionally connect a prompt and enable trigger-word controls in Settings.
7. Save useful combinations as an Active LoRA preset, or preserve the complete node as a Full setup preset.
8. Optionally connect **Apex Preset Jobs**, add frozen active-preset runs, arrange them, and queue the list from the helper.

Enabled, nonzero-strength rows are applied down each section and column, proceeding through columns from left to right. Disabled and zero-strength rows are skipped.

---

## Loading and compatibility

Apex delegates LoRA application to ComfyUI's standard model path:

1. Resolve with `folder_paths.get_full_path_or_raise`.
2. Load safely with `comfy.utils.load_torch_file(..., safe_load=True, return_metadata=True)`.
3. Apply with `comfy.sd.load_lora_for_models`, using the row's model strength and zero CLIP strength.

Loaded LoRA state dictionaries are reused only within the current node execution and discarded afterward. Repeated rows still apply as separate ordered patches.

Because patch application remains owned by the incoming ComfyUI model patcher, native INT8 ConvRot models can use ordinary BF16/FP16 LoRAs through Apex. Models produced by specialized loaders retain the behavior of their own patcher; Apex adds no separate quantization path.

An enabled row that cannot be resolved fails clearly instead of silently loading a different file.

## Data and privacy

| Data | Scope | Storage |
| --- | --- | --- |
| Sections, rows, order, filters, settings, and trigger placement | Per node/workflow | Hidden versioned JSON serialized by ComfyUI |
| Frozen Preset Jobs list and view mode | Per helper node/workflow | Separate hidden versioned JSON serialized by ComfyUI |
| Preset Jobs execution results | Current browser session | Memory only |
| Active LoRA and full setup presets | Installation-wide | `ComfyUI/user/__apex_lora_loader/presets.json` by default |
| Hashes and trigger-word metadata | Installation-wide | `ComfyUI/user/__apex_lora_loader/lora_metadata.json` by default |
| Loaded LoRA tensors | Current execution only | Memory |

Apex follows ComfyUI's configured system user directory. It makes no downloads, telemetry calls, analytics requests, remote metadata lookups, or other background network requests.

---

## Credits and provenance

Apex's original implementation was created for this project. No source from the reference-only custom nodes below is bundled; they are credited for the APIs, interaction patterns, or compatibility questions they helped inform.

| Project | Relationship | What Apex builds around or adds |
| --- | --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Runtime foundation and canonical LoRA loading/application APIs. | Ordered multi-row orchestration, responsive sections, filtering, presets, identity recovery, and prompt metadata. |
| [rgthree-comfy Power LoRA Loader](https://github.com/rgthree/rgthree-comfy) | UX reference for compact rows, per-row controls, reordering, and horizontal strength dragging. | Named manual section columns, recursive folder filters, global presets, rename recovery, trigger arrays, and prompt routing. |
| [Fantastic LoRAs](https://github.com/Adudeguyman/comfyui_fantastic-loras) | Design reference for serialized custom rows, searchable selection, and per-node filtering. | Manual responsive columns, hash-based identity, smart presets, confirmed bulk addition, and local trigger metadata. |
| [ComfyUI-Lora-Auto-Trigger-Words](https://github.com/idrirap/ComfyUI-Lora-Auto-Trigger-Words) | Concept reference for associating LoRAs, hashes, and trigger words. | Fully local manual metadata, multiple active choices, editable chips, and per-row placement without remote lookup. |
| [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | Technical reference while reviewing LoRA application patterns. | Apex remains model-agnostic and delegates the actual patch operation to ComfyUI core. |
| [ComfyUI-INT8-Fast](https://github.com/BobJohnson24/ComfyUI-INT8-Fast) | Compatibility reference for LoRAs used with INT8 ConvRot models. | No INT8-Fast code or quantization math is included; Apex respects the incoming model patcher. |
| [Lucide](https://github.com/lucide-icons/lucide) | Source of the embedded interface SVG path data. | Icons are rendered locally with `currentColor`; no icon package is required at runtime. |
| [OpenAI Codex](https://openai.com/codex/) | Implementation partner for the fully vibe-coded development process. | The final behavior was shaped through human-directed feature design, testing, and iteration. |

## License

Apex LoRA Loader's original code is released under the [MIT License](LICENSE).

Embedded Lucide icons retain their ISC terms, and Feather-derived Lucide icons retain their MIT terms. The required notices are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). ComfyUI and every referenced project remain governed by their respective licenses.

[license-shield]: https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square
[license-link]: LICENSE
[version-shield]: https://img.shields.io/badge/version-v0.4.1-1f6feb?style=flat-square
[version-link]: https://github.com/lericogit/apex-lora-loader/releases
[comfyui-shield]: https://img.shields.io/badge/ComfyUI-custom_node-6f42c1?style=flat-square
[comfyui-link]: https://github.com/Comfy-Org/ComfyUI
[local-shield]: https://img.shields.io/badge/network-local_only-0a7f5a?style=flat-square
[local-link]: #data-and-privacy
[dependencies-shield]: https://img.shields.io/badge/extra_dependencies-none-4c8bf5?style=flat-square
[dependencies-link]: #installation
