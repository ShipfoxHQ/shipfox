variable "qemu_source_image" {
  type    = string
  default = null
}

variable "qemu_source_checksum" {
  type    = string
  default = null
}

variable "qemu_accelerator" {
  type    = string
  default = "kvm"

  validation {
    condition     = contains(["kvm", "tcg"], var.qemu_accelerator)
    error_message = "QEMU accelerator must be kvm or tcg."
  }
}

variable "qemu_headless" {
  type    = bool
  default = true
}
