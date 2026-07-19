variable "build_number" {
  type = string
}

variable "build_attempt" {
  type    = string
  default = "1"
}

variable "architecture" {
  type    = string
  default = "amd64"
  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "Architecture must be amd64 or arm64."
  }
}

variable "image_os" {
  type    = string
  default = "ubuntu24"
}

variable "node_version" {
  type = string
}

variable "revision" {
  type    = string
  default = "local"
}

variable "runner_version" {
  type    = string
  default = "0.0.0-local"
}

variable "os_disk_size_gb" {
  type    = number
  default = 100
}

variable "platform" {
  type = string
  validation {
    condition     = contains(["aws", "qemu"], var.platform)
    error_message = "Platform must be aws or qemu."
  }
}

variable "runner_workspace" {
  type = string
}
