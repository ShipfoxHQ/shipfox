---
"@shipfox/api-runners": minor
---

Accepts `templateOrder: 'smallest'` in the installation placement policy, which sends an unsized job to the template with the fewest units before falling back to the default order. Adds the `runners_placement_template_changed_total` counter, labeled by `order`, to measure how many launches the order would change.
