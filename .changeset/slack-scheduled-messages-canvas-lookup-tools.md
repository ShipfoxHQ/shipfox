---
"@shipfox/api-integration-slack": minor
---

Adds the `list_scheduled_messages` and `lookup_canvas_sections` read tools. `list_scheduled_messages` lists the messages scheduled for future delivery. `lookup_canvas_sections` finds the sections of a canvas by text or type. The Slack app now requests the `canvases:read` bot scope, so an installation made before this change needs a reinstall before `lookup_canvas_sections` works.
