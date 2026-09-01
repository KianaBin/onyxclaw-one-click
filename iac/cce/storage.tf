resource "huaweicloud_networking_secgroup" "sfs" {
  count = var.manage_sfs ? 1 : 0

  name        = var.sfs_security_group_name
  description = "OnyxClaw SFS Turbo access"
}

resource "huaweicloud_sfs_turbo" "this" {
  count = var.manage_sfs ? 1 : 0

  name                             = var.sfs_name
  size                             = var.sfs_size_gb
  share_proto                      = "NFS"
  share_type                       = var.sfs_share_type
  availability_zone                = var.availability_zone
  vpc_id                           = local.target_vpc_id
  subnet_id                        = local.target_subnet_id
  security_group_id                = huaweicloud_networking_secgroup.sfs[0].id
  auto_create_security_group_rules = "true"
  tags                             = local.cce_tags
}
