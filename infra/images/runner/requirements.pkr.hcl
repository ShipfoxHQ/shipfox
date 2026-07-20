packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "= 1.8.2"
    }
    qemu = {
      source  = "github.com/hashicorp/qemu"
      version = "= 1.1.3"
    }
  }
}
