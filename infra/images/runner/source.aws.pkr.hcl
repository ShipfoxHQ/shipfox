source "amazon-ebs" "build_image" {
  ami_name                    = "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}"
  ami_virtualization_type     = "hvm"
  associate_public_ip_address = true
  encrypt_boot                = true
  imds_support                = "v2.0"
  instance_type               = var.architecture == "amd64" ? "t3.large" : "t4g.large"
  region                      = "us-east-1"
  shutdown_behavior           = "terminate"
  ssh_username                = "ubuntu"

  source_ami_filter {
    filters = {
      architecture        = local.aws_architecture
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${local.aws_architecture}-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    most_recent = true
    owners      = ["099720109477"]
  }

  tags = {
    Name                   = "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}"
    "shipfox.build_number" = var.build_number
    "shipfox.image_os"     = var.image_os
    "shipfox.architecture" = var.architecture
    "shipfox.runner"       = "@shipfox/runner"
  }
}
