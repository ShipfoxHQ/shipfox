# @shipfox/provisioner-docker-provider

The Docker provider for the Shipfox provisioner. It supplies the Docker-specific
configuration and launcher that [`@shipfox/provisioner-core`](../core) drives, and is
wired into the runnable [`@shipfox/provisioner-docker`](../../../apps/provisioner-docker)
app.

## Public API

- `startDockerProvisioner()` — load the local Docker templates and run the control
  loop against them.
- `loadDockerTemplates(filePath)` — read, parse, and validate the template YAML,
  returning provider-agnostic `ProvisionerTemplate`s with a `DockerTemplateSpec`.
- `DockerTemplateSpec` — the Docker launch details (`image`, `cpu`, `memory`).
- `DockerTemplateConfigError` — thrown on any config problem.

## Template config

The template file is YAML keyed by template name:

```yaml
templates:
  docker-ubuntu22-2vcpu:
    labels: [ubuntu22, ubuntu22-2vcpu]
    image: shipfox-runner:ubuntu22
    cpu: 2
    memory: 4GiB
    max_concurrency: 100
```

Loading fails fast with a clear, file-scoped error on a missing file, malformed YAML,
an invalid field, an unusable label, or an empty template set. Labels are canonicalized
(trim, lowercase, dedupe, sort) with the shared runner-label rules. The vCPU count
becomes the template's selection cost, so generic demand lands on the cheapest box.

## Current behavior

This package loads and validates Docker template configuration, joins the shared
provisioner control loop, and logs each planned runner. It does not start containers,
report lifecycle, or reconcile existing containers on restart.
