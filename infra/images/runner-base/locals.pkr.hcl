locals {
  aws_architecture = var.architecture == "amd64" ? "x86_64" : "arm64"
  instance_type    = var.architecture == "amd64" ? "c8a.xlarge" : "c8g.xlarge"
  region           = "eu-central-1"
  image_name       = "shipfox-runner-base-${var.image_os}-${var.architecture}-${var.generation}"

  # Tag names are part of the base contract. Keep them aligned with src/metadata.ts.
  base_tags = {
    Name                      = local.image_name
    "shipfox.architecture"    = var.architecture
    "shipfox.base_generation" = var.generation
    "shipfox.base_recipe"     = var.recipe_digest
    "shipfox.base_status"     = "building"
    "shipfox.image_os"        = var.image_os
    "shipfox.lifecycle"       = "runner-base"
    "shipfox.managed"         = "true"
    "shipfox.revision"        = var.revision
  }
}
