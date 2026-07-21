# @shipfox/provisioner-ec2-provider

The EC2 provider scaffold for the Shipfox provisioner. It currently loads and validates
EC2 template configuration for the provider-agnostic
[`@shipfox/provisioner-core`](../core) control loop. The EC2 engine, lifecycle, and app
wiring land in later issues.

## Public API

- `loadEc2Templates(filePath)` reads, parses, and validates EC2 template YAML.
- `Ec2TemplateSpec` describes the EC2 launch details for a template.
- `Ec2TemplateConfigError` identifies a missing, malformed, or invalid template file.
- `renderRunnerBootstrapUserData(options)` renders cloud-init for the prebaked managed-runner image.
- `redactRunnerBootstrapUserData(options)` returns launch metadata that is safe to log.

The user-data renderer writes the API URL, one-use bootstrap token, runner-declared labels,
managed-runner protocol metadata, poll deadline, and watchdog lifetime. It never renders a
workspace ID, workspace registration token, or activation token.

## Template config

The template file is YAML keyed by template name:

```yaml
templates:
  ec2-ubuntu22-2vcpu-spot:
    labels: [ubuntu22, ubuntu22-2vcpu]
    ami: ami-0123456789abcdef0
    instance_type: m6i.large
    market: spot
    spot_max_price: null
    subnets: [subnet-aaa, subnet-bbb]
    security_groups: [sg-runner]
    iam_instance_profile: shipfox-runner
    associate_public_ip: false
    root_volume_gb: 100
    max_concurrency: 200
    cost: 5
```

Loading fails fast with a clear, file-scoped error on a missing file, malformed YAML, an
invalid or unknown field, an unusable label, or an empty template set. Labels are
canonicalized with the shared runner-label rules.

`iam_instance_profile` is the IAM instance-profile name, not its ARN. For Spot templates,
`spot_max_price: null` caps the request at the on-demand price and is the recommended
default. Set `cost` to an explicit unitless ranking where lower values win template
selection. Give a Spot template a lower cost than its on-demand equivalent so the planner
prefers Spot before spilling to on-demand capacity.

## Runtime configuration

The provider reads the shared provisioner variables plus these EC2-specific variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | - | YAML template file with EC2 launch and capacity configuration. |
| `AWS_REGION` | yes | - | AWS region where runner instances launch. |
| `SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS` | no | `300000` | Maximum time a launched instance may wait for runner registration. |
| `SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS` | no | `60000` | Interval for a full backend reconcile using EC2 instance tags. |
