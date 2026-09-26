build {
  name    = "base"
  sources = ["amazon-ebs.base"]

  provisioner "shell" {
    execute_command = "sudo -E sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "${path.root}/scripts/build/prepare-os.sh",
      "${path.root}/scripts/build/clean-identity.sh"
    ]
  }

  post-processor "manifest" {
    output     = "packer-manifest.json"
    strip_path = true
    custom_data = {
      architecture  = var.architecture
      generation    = var.generation
      image_os      = var.image_os
      recipe_digest = var.recipe_digest
      revision      = var.revision
      source_ami_id = var.source_ami_id
    }
  }
}

build {
  name    = "verify"
  sources = ["amazon-ebs.verify"]

  provisioner "shell" {
    environment_vars = ["SHIPFOX_RUNNER_BASE_ARCHITECTURE=${var.architecture}"]
    execute_command  = "sudo -E sh -c '{{ .Vars }} {{ .Path }}'"
    scripts          = ["${path.root}/scripts/verify/verify-instance.sh"]
  }
}
