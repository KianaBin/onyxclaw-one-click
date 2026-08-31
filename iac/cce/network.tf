resource "huaweicloud_vpc" "this" {
  name = var.vpc_name
  cidr = var.vpc_cidr
  tags = local.cce_tags
}

resource "huaweicloud_vpc_subnet" "this" {
  name              = var.subnet_name
  cidr              = var.subnet_cidr
  gateway_ip        = var.subnet_gateway_ip
  vpc_id            = huaweicloud_vpc.this.id
  availability_zone = var.availability_zone
  primary_dns       = var.subnet_primary_dns
  secondary_dns     = var.subnet_secondary_dns
  tags              = local.cce_tags
}

locals {
  target_vpc_id    = huaweicloud_vpc.this.id
  target_subnet_id = huaweicloud_vpc_subnet.this.id
}
