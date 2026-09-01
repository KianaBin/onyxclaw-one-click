resource "huaweicloud_vpc" "this" {
  count = var.network_mode == "create" ? 1 : 0

  name = var.vpc_name
  cidr = var.vpc_cidr
  tags = local.cce_tags
}

resource "huaweicloud_vpc_subnet" "this" {
  count = var.network_mode == "create" ? 1 : 0

  name              = var.subnet_name
  cidr              = var.subnet_cidr
  gateway_ip        = var.subnet_gateway_ip
  vpc_id            = huaweicloud_vpc.this[0].id
  availability_zone = var.availability_zone
  primary_dns       = var.subnet_primary_dns
  secondary_dns     = var.subnet_secondary_dns
  tags              = local.cce_tags
}

locals {
  target_vpc_id    = var.network_mode == "existing" ? var.existing_vpc_id : huaweicloud_vpc.this[0].id
  target_subnet_id = var.network_mode == "existing" ? var.existing_subnet_id : huaweicloud_vpc_subnet.this[0].id
}
