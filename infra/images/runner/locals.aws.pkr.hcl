locals {
  aws_architecture    = var.architecture == "amd64" ? "x86_64" : "arm64"
  ubuntu_architecture = var.architecture

  from_runner_base = var.source_ami_id != ""
  source_ami_filters = local.from_runner_base ? {
    architecture                  = local.aws_architecture
    "tag:shipfox.architecture"    = var.architecture
    "tag:shipfox.base_generation" = var.base_generation
    "tag:shipfox.base_recipe"     = var.base_recipe
    "tag:shipfox.base_status"     = "verified"
    "tag:shipfox.lifecycle"       = "runner-base"
    "tag:shipfox.managed"         = "true"
    } : {
    architecture        = local.aws_architecture
    name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${local.ubuntu_architecture}-server-*"
    root-device-type    = "ebs"
    virtualization-type = "hvm"
  }

  image_name = var.image_lifecycle == "candidate" ? "shipfox-runner-candidate-${var.candidate_id}-${var.architecture}" : "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}-${var.build_attempt}"

  image_tags = merge({
    Name                    = local.image_name
    "shipfox.build_attempt" = var.build_attempt
    "shipfox.build_number"  = var.build_number
    "shipfox.image_os"      = var.image_os
    "shipfox.architecture"  = var.architecture
    "shipfox.runner"        = "@shipfox/runner"
    "shipfox.revision"      = var.revision
    "shipfox.lifecycle"     = var.image_lifecycle
    "shipfox.managed"       = "true"
    },
    var.image_lifecycle == "candidate" ? {
      "shipfox.candidate_id" = var.candidate_id
      "shipfox.expires_at"   = var.candidate_expires_at
    } : {},
    var.runner_version != "" ? { "shipfox.runner_version" = var.runner_version } : {},
    # Base provenance. The candidate planner compares the generation with the newest published pair.
    local.from_runner_base ? {
      "shipfox.base_generation" = var.base_generation
      "shipfox.base_recipe"     = var.base_recipe
      "shipfox.source_ami_id"   = var.source_ami_id
    } : {},
  )
}
