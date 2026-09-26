source "amazon-ebs" "base" {
  ami_name                    = local.image_name
  ami_virtualization_type     = "hvm"
  associate_public_ip_address = true
  imds_support                = "v2.0"
  instance_type               = local.instance_type
  region                      = local.region
  shutdown_behavior           = "terminate"
  source_ami                  = var.source_ami_id
  ssh_username                = "ubuntu"

  # Packer applies this filter to the exact source AMI, so a pinned ID from another owner,
  # architecture, or Ubuntu release fails before any instance launches.
  source_ami_filter {
    filters = {
      architecture        = local.aws_architecture
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${var.architecture}-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners = ["099720109477"]
  }

  launch_block_device_mappings {
    delete_on_termination = true
    device_name           = "/dev/sda1"
    encrypted             = true
    kms_key_id            = var.kms_key_id
    volume_size           = var.os_disk_size_gb
    volume_type           = "gp3"
  }

  run_tags      = local.base_tags
  snapshot_tags = local.base_tags
  tags          = local.base_tags
}

# Boots the captured base as a new instance with Packer's new temporary key pair. It creates no image.
source "amazon-ebs" "verify" {
  ami_name                    = "${local.image_name}-verify"
  associate_public_ip_address = true
  imds_support                = "v2.0"
  instance_type               = local.instance_type
  region                      = local.region
  shutdown_behavior           = "terminate"
  skip_create_ami             = true
  source_ami                  = var.base_ami_id
  ssh_username                = "ubuntu"

  source_ami_filter {
    filters = {
      "tag:shipfox.base_generation" = var.generation
      "tag:shipfox.lifecycle"       = "runner-base"
    }
    owners = ["self"]
  }

  run_tags = merge(local.base_tags, { Name = "${local.image_name}-verify" })
}
