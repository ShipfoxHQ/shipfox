variable "qemu_source_image" {
  type    = string
  default = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
}

variable "qemu_headless" {
  type    = bool
  default = true
}
