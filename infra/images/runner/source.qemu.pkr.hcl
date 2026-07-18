source "qemu" "build_image" {
  accelerator      = var.qemu_accelerator
  cd_files         = ["${path.root}/assets/qemu/cloud-init/meta-data", "${path.root}/assets/qemu/cloud-init/user-data"]
  cd_label         = "cidata"
  disk_image       = true
  disk_size        = "${var.os_disk_size_gb}G"
  format           = "raw"
  headless         = var.qemu_headless
  iso_checksum     = local.qemu_source_checksum
  iso_url          = local.qemu_source_image
  net_device       = "virtio-net"
  output_directory = "output"
  qemu_binary      = local.qemu_binary
  shutdown_command = "echo 'packer' | sudo -S shutdown -P now"
  ssh_password     = "packer"
  ssh_timeout      = "5m"
  ssh_username     = "ubuntu"
  vm_name          = "machine.raw"
}
