locals {
  qemu_binary = var.architecture == "amd64" ? "qemu-system-x86_64" : "qemu-system-aarch64"
}
