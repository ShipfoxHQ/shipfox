variable "architecture" {
  type = string
  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "Architecture must be amd64 or arm64."
  }
}

variable "base_ami_id" {
  type        = string
  default     = ""
  description = "Captured base AMI launched by the verify build."
  validation {
    condition     = var.base_ami_id == "" || can(regex("^ami-[0-9a-f]{17}$", var.base_ami_id))
    error_message = "Base AMI ID must be an AMI ID."
  }
}

variable "generation" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.generation))
    error_message = "Generation must contain only letters, numbers, dots, underscores, or hyphens."
  }
}

variable "image_os" {
  type    = string
  default = "ubuntu24"
  validation {
    condition     = var.image_os == "ubuntu24"
    error_message = "The runner base supports only ubuntu24."
  }
}

variable "kms_key_id" {
  type        = string
  description = "Runner image candidate KMS key. Derived candidates must share it."
  validation {
    condition     = var.kms_key_id != ""
    error_message = "KMS key ID is required."
  }
}

variable "node_version" {
  type        = string
  description = "Node version pinned in mise.toml. The recipe digest covers it."
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.node_version))
    error_message = "Node version must be an exact version such as 24.17.0."
  }
}

variable "os_disk_size_gb" {
  type    = number
  default = 30
}

variable "recipe_digest" {
  type = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.recipe_digest))
    error_message = "Recipe digest must be a sha256 digest."
  }
}

variable "revision" {
  type    = string
  default = "local"
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.revision))
    error_message = "Revision must contain only letters, numbers, dots, underscores, or hyphens."
  }
}

variable "source_ami_id" {
  type        = string
  description = "Exact Canonical Ubuntu 24.04 AMI for this architecture."
  validation {
    condition     = can(regex("^ami-[0-9a-f]{17}$", var.source_ami_id))
    error_message = "Source AMI ID must be an AMI ID."
  }
}
