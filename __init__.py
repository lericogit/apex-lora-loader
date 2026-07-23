from .nodes import (
    NODE_CLASS_MAPPINGS as LOADER_NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as LOADER_NODE_DISPLAY_NAME_MAPPINGS,
)

NODE_CLASS_MAPPINGS = dict(LOADER_NODE_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS = dict(LOADER_NODE_DISPLAY_NAME_MAPPINGS)

# The helper is intentionally optional. Removing its module leaves the loader
# registered and fully functional, including workflows without its connection.
try:
    from .preset_jobs_node import (
        NODE_CLASS_MAPPINGS as JOBS_NODE_CLASS_MAPPINGS,
        NODE_DISPLAY_NAME_MAPPINGS as JOBS_NODE_DISPLAY_NAME_MAPPINGS,
    )
except ModuleNotFoundError as error:
    if error.name not in {f"{__package__}.preset_jobs_node", "preset_jobs_node"}:
        raise
else:
    NODE_CLASS_MAPPINGS.update(JOBS_NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(JOBS_NODE_DISPLAY_NAME_MAPPINGS)

from . import api as _api

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
