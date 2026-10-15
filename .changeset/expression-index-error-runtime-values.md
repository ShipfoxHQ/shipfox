---
'@shipfox/expression': patch
---

An out-of-range list index error no longer reports the list size, and reports the index only when the expression writes it as an integer literal. A computed index, such as `event.values[int(event.position)]`, now produces an `evaluation-error` detail with the `index_out_of_bounds` classification, and a summary without numbers.
