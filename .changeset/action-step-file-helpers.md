---
"@shipfox/actions": minor
---

Adds `setEnv`, `addPath`, and `addMask` to the action handler context.

- **`setEnv(name, value)`** sets an environment variable for the later steps of the job. It rejects `PATH` and names starting with `SHIPFOX_`.
- **`addPath(directory)`** puts a directory at the front of `PATH` for the later steps of the job.
- **`addMask(value)`** masks a value in the logs, outputs, and annotations of the later steps of the job, through the new `SHIPFOX_MASK` file. A value shorter than 8 characters throws. A multi-line value is masked line by line.

The helpers write right away, so the values survive a later throw. `runAction` now sets the three files and returns `carriedEnv`, `carriedPath`, and `masks`.

The contract adds the `env`, `path`, and `mask` names to `ACTION_ENV`, and `MIN_MASKED_VALUE_LENGTH`.
