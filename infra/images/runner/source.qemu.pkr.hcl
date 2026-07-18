source "qemu" "build_image" {
  accelerator      = "kvm"
  disk_image       = true
  disk_size        = "${var.os_disk_size_gb}G"
  format           = "raw"
  headless         = var.qemu_headless
  iso_checksum     = "none"
  iso_url          = var.qemu_source_image
  net_device       = "virtio-net"
  output_directory = "output"
  qemu_binary      = local.qemu_binary
  shutdown_command = "echo 'packer' | sudo -S shutdown -P now"
  ssh_password     = "packer"
  ssh_timeout      = "5m"
  ssh_username     = "ubuntu"
  vm_name          = "machine.raw"
}
