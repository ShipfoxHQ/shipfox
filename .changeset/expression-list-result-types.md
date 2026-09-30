---
'@shipfox/expression': patch
---

Types a list built by a `map` macro as a list. The type checker named a list of dynamic elements `list`, so `result.items.map(item, item.name)` was typed as an object. A tool step that kept that list in an output failed with `Output does not match its JSON Schema` on every run. It also keeps the element type of lists such as `list<string>`.
