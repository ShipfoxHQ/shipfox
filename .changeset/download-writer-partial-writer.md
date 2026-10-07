---
"@shipfox/actions": minor
---

Lets `writeDownloadedFile` hand its partial file to a caller-supplied writer. The new `writePartial` option replaces the local `fs` write, so the runner can write downloads through its execution host. Without it, the file is written as before.
