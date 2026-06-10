---
"@shipfox/api-workflows": minor
---

Execute step gates at runtime: evaluate `gate.success_if` (CEL) against the step's exit code to decide pass/fail — overriding the raw command status — and record the gate result on the attempt. A failing gate fails the job; a missing exit code or an evaluation error fails closed as a plain command failure; a failing gate with `on_failure.restart_from` fails closed with a structured `restart_unsupported` error until durable restart lands.
