locals {
  qemu_binary = var.architecture == "amd64" ? "qemu-system-x86_64" : "qemu-system-aarch64"
  qemu_source_image = coalesce(
    var.qemu_source_image,
    "https://cloud-images.ubuntu.com/releases/noble/release-20260705/ubuntu-24.04-server-cloudimg-${var.architecture}.img",
  )
  qemu_source_checksum = coalesce(
    var.qemu_source_checksum,
    var.architecture == "amd64"
      ? "sha256:ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6"
      : "sha256:7ed8005503e0bf1c225371866faae56e6b7e0d5c12471961042ab1cc2a1ffb4b",
  )
}
