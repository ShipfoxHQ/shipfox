variable "build_number" {
  type = string
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

variable "push_image" {
  type    = bool
  default = false
}

variable "runner_workspace" {
  type = string
}
