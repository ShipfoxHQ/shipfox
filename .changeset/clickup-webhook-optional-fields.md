---
"@shipfox/api-integration-clickup-dto": patch
---

ClickUp webhook deliveries whose change records leave out `data`, `source`, `before`, or `after`, or whose user has a `null` username, email, or initials, now pass validation. ClickUp leaves `before` out when a tag is added, so tag events were dropped before they reached a trigger. A trigger filter that reads `after` should check `has(item.after)` first.
