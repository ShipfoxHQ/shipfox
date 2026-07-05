---
"@shipfox/vitest": patch
---

Lets package Vitest configs override the shared CI worker cap so small suites can default to one worker while heavier suites keep targeted parallelism.
