resource "huaweicloud_vpc_eip" "snat" {
  count = var.manage_snat ? 1 : 0

  name = var.snat_eip_name

  publicip {
    type = var.api_server_eip_type
  }

  bandwidth {
    name        = "${var.snat_eip_name}-bandwidth"
    size        = var.snat_eip_bandwidth_mbps
    share_type  = "PER"
    charge_mode = "traffic"
  }

  tags = local.cce_tags
}

resource "huaweicloud_nat_gateway" "this" {
  count = var.manage_snat ? 1 : 0

  name      = var.nat_gateway_name
  spec      = var.nat_gateway_spec
  vpc_id    = local.target_vpc_id
  subnet_id = local.target_subnet_id
  tags      = local.cce_tags
}

resource "huaweicloud_nat_snat_rule" "this" {
  count = var.manage_snat ? 1 : 0

  nat_gateway_id = huaweicloud_nat_gateway.this[0].id
  floating_ip_id = huaweicloud_vpc_eip.snat[0].id
  subnet_id      = local.target_subnet_id
  description    = "OnyxClaw AgentSphere Sandbox outbound access"
}
