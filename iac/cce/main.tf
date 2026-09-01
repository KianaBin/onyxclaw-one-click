locals {
  cce_tags = merge(var.cluster_tags, {
    app        = "onyxclaw"
    managed_by = "terraform"
  })
}

resource "huaweicloud_vpc_eip" "api_server" {
  name = var.api_server_eip_name

  publicip {
    type = var.api_server_eip_type
  }

  bandwidth {
    name        = "${var.api_server_eip_name}-bandwidth"
    size        = var.api_server_eip_bandwidth_mbps
    share_type  = "PER"
    charge_mode = "traffic"
  }

  tags = local.cce_tags
}

resource "huaweicloud_cce_cluster" "this" {
  name                   = var.cluster_name
  cluster_type           = "VirtualMachine"
  flavor_id              = var.cluster_flavor_id
  cluster_version        = var.cluster_version
  vpc_id                 = local.target_vpc_id
  subnet_id              = local.target_subnet_id
  container_network_type = var.container_network_type
  container_network_cidr = var.container_network_cidr
  service_network_cidr   = var.service_network_cidr
  authentication_mode    = "rbac"
  kube_proxy_mode        = var.kube_proxy_mode
  security_group_id      = var.node_security_group_id
  eip                    = huaweicloud_vpc_eip.api_server.address
  charging_mode          = "postPaid"
  tags                   = local.cce_tags

  lifecycle {
    precondition {
      condition = var.network_mode == "create" ? (
        trimspace(coalesce(var.existing_vpc_id, "")) == "" &&
        trimspace(coalesce(var.existing_subnet_id, "")) == ""
        ) : (
        trimspace(coalesce(var.existing_vpc_id, "")) != "" &&
        trimspace(coalesce(var.existing_subnet_id, "")) != ""
      )
      error_message = "network_mode=create must not set existing network IDs; network_mode=existing requires both existing_vpc_id and existing_subnet_id."
    }
  }
}

resource "huaweicloud_cce_node" "this" {
  cluster_id        = huaweicloud_cce_cluster.this.id
  name              = var.worker_node_name
  flavor_id         = var.worker_node_flavor_id
  availability_zone = var.availability_zone
  os                = var.worker_node_os
  runtime           = "containerd"
  subnet_id         = local.target_subnet_id
  key_pair          = var.worker_node_key_pair
  password          = var.worker_node_password
  labels            = var.worker_node_labels
  tags              = local.cce_tags

  root_volume {
    size       = var.worker_node_root_volume.size
    volumetype = var.worker_node_root_volume.volumetype
  }

  dynamic "data_volumes" {
    for_each = var.worker_node_data_volumes

    content {
      size       = data_volumes.value.size
      volumetype = data_volumes.value.volumetype
    }
  }

  iptype                = var.enable_worker_node_eip ? var.worker_node_eip_type : null
  bandwidth_charge_mode = var.enable_worker_node_eip ? "traffic" : null
  sharetype             = var.enable_worker_node_eip ? "PER" : null
  bandwidth_size        = var.enable_worker_node_eip ? var.worker_node_eip_bandwidth_mbps : null
}
