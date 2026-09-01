output "cluster_id" {
  description = "CCE cluster ID."
  value       = huaweicloud_cce_cluster.this.id
}

output "cluster_name" {
  description = "CCE cluster name."
  value       = huaweicloud_cce_cluster.this.name
}

output "api_server_eip_address" {
  description = "Public EIP bound to the CCE API Server. Download kubeconfig manually from the CCE console after apply."
  value       = huaweicloud_vpc_eip.api_server.address
}

output "worker_node_id" {
  description = "CCE worker node ID."
  value       = huaweicloud_cce_node.this.id
}

output "worker_node_private_ip" {
  description = "Private IP of the CCE worker node."
  value       = huaweicloud_cce_node.this.private_ip
}

output "worker_node_public_ip" {
  description = "Public IP of the worker node when enable_worker_node_eip is true."
  value       = huaweicloud_cce_node.this.public_ip
}

output "worker_node_status" {
  description = "CCE worker node status. Continue only after it is Active/Ready."
  value       = huaweicloud_cce_node.this.status
}

output "vpc_id" {
  description = "VPC used by CCE, AgentSphere, NAT/SNAT, and SFS Turbo."
  value       = local.target_vpc_id
}

output "subnet_id" {
  description = "Subnet used by CCE, AgentSphere, NAT/SNAT, and SFS Turbo."
  value       = local.target_subnet_id
}

output "snat_eip_address" {
  description = "Dedicated SNAT EIP address when manage_snat is true."
  value       = try(huaweicloud_vpc_eip.snat[0].address, null)
}

output "nat_gateway_id" {
  description = "Public NAT Gateway ID when manage_snat is true."
  value       = try(huaweicloud_nat_gateway.this[0].id, null)
}

output "snat_rule_id" {
  description = "SNAT rule ID when manage_snat is true."
  value       = try(huaweicloud_nat_snat_rule.this[0].id, null)
}

output "sfs_turbo_id" {
  description = "SFS Turbo ID when manage_sfs is true. Copy it to SFS_TURBO_ID."
  value       = try(huaweicloud_sfs_turbo.this[0].id, null)
}

output "sfs_nfs_export_location" {
  description = "SFS Turbo NFS export location when manage_sfs is true."
  value       = try(huaweicloud_sfs_turbo.this[0].export_location, null)
}
