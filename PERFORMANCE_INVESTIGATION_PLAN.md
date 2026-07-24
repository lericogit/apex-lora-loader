# Apex LoRA Loader Zoom Performance Investigation

Review the Apex LoRA Loader frontend code and the relevant ComfyUI DOM-widget code to identify possible causes of severe canvas zoom stuttering. Do not modify any code. Focus on static code analysis only.

Canvas panning is generally smooth, but zooming in and out becomes heavily stuttery whenever an Apex LoRA Loader exists. The problem becomes more noticeable with additional sections and LoRA rows. Collapsing the complete node does not eliminate it, while removing the node restores smooth performance. Apex previously used `hideOnZoom: false`; removing that override made its content hide like other nodes at low zoom but did not improve the stutter. A prior review found no recurring Apex timers, observers, background scans, or intentional continuous layout loop.

Inspect the repository frontend files, especially `web/apex_lora_loader.js` and `web/apex_lora_loader.css`, together with the corresponding DOM-widget lifecycle, visibility, positioning, and zoom behavior in the installed ComfyUI frontend. Use generic installation-relative paths such as `<ComfyUI>/venv/Lib/site-packages/comfyui_frontend_package/` when needed. Follow the code without assuming that Apex, ComfyUI, DOM size, CSS rendering, or widget registration is necessarily responsible.

Report the most likely cause or causes, explain the relevant code path, and suggest a small number of practical fixes ranked by expected benefit and risk. Clearly distinguish confirmed findings from informed hypotheses.
