---
"@shipfox/provisioner-core": patch
"@shipfox/provisioner-docker-provider": patch
---

Add the Docker provisioner control loop.

- New `@shipfox/provisioner-core`: the provider-agnostic control loop a provisioner runs. It authenticates with a provisioner token, long-polls demand while advertising per-template capacity, deterministically selects a local template for each reservation label set (cheapest matching template first, with capacity-aware fan-out), batch-mints one single-use registration token per planned runner, and hands each to a provider launcher. It never reserves more than its templates have free capacity. Template selection and capacity planning are pure and unit-tested.
- New `@shipfox/provisioner-docker-provider`: the Docker provider. It reads, validates, and canonicalizes the local Docker template YAML (labels, image, cpu, memory, max_concurrency), failing fast with clear, file-scoped errors, and wires `startDockerProvisioner()`. The current launcher logs each planned runner; it does not start containers, report lifecycle, or reconcile on restart.
