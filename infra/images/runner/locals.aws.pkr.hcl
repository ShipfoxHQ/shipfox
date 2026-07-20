locals {
  aws_architecture    = var.architecture == "amd64" ? "x86_64" : "arm64"
  ubuntu_architecture = var.architecture
}
