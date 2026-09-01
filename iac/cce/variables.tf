variable "region" {
  description = "Huawei Cloud region, for example cn-south-1."
  type        = string
}

variable "hw_access_key" {
  description = "Huawei Cloud access key. Put it in the ignored secrets.auto.tfvars file, or leave null to use the provider environment fallback."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "hw_secret_key" {
  description = "Huawei Cloud secret key. Put it in the ignored secrets.auto.tfvars file, or leave null to use the provider environment fallback."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "availability_zone" {
  description = "Availability zone for the CCE worker node."
  type        = string
}

variable "vpc_name" {
  description = "Name for the dedicated Terraform-managed VPC."
  type        = string
  default     = "onyxclaw-demo-vpc"
}

variable "vpc_cidr" {
  description = "CIDR for a Terraform-created VPC."
  type        = string
  default     = "192.168.0.0/16"
}

variable "subnet_name" {
  description = "Name for a Terraform-created CCE and AgentSphere subnet."
  type        = string
  default     = "onyxclaw-demo-subnet"
}

variable "subnet_cidr" {
  description = "CIDR for a Terraform-created subnet. It must be inside vpc_cidr."
  type        = string
  default     = "192.168.0.0/24"
}

variable "subnet_gateway_ip" {
  description = "Gateway IP for a Terraform-created subnet."
  type        = string
  default     = "192.168.0.1"
}

variable "subnet_primary_dns" {
  description = "Primary DNS for a Terraform-created subnet."
  type        = string
  default     = "100.125.1.250"
}

variable "subnet_secondary_dns" {
  description = "Secondary DNS for a Terraform-created subnet."
  type        = string
  default     = "100.125.136.29"
}

variable "node_security_group_id" {
  description = "Optional existing default worker-node security-group ID. Leave null to let CCE create its default group."
  type        = string
  default     = null
  nullable    = true
}

variable "cluster_name" {
  description = "Name of the CCE cluster."
  type        = string
}

variable "cluster_flavor_id" {
  description = "CCE cluster flavor, such as cce.s1.small for a 50-node single-master Demo/Test cluster."
  type        = string
  default     = "cce.s1.small"
}

variable "cluster_version" {
  description = "CCE version available in the target region. Set null to use the provider/API default."
  type        = string
  default     = null
  nullable    = true
}

variable "container_network_type" {
  description = "CCE container network type. Use vpc-router for the tested VPC-network profile."
  type        = string
  default     = "vpc-router"

  validation {
    condition     = contains(["overlay_l2", "vpc-router", "eni"], var.container_network_type)
    error_message = "container_network_type must be overlay_l2, vpc-router, or eni."
  }
}

variable "container_network_cidr" {
  description = "CIDR for Pods. It must not overlap the VPC or Service CIDRs."
  type        = string
}

variable "service_network_cidr" {
  description = "CIDR for Kubernetes Services. It must not overlap the VPC or container CIDRs."
  type        = string
}

variable "kube_proxy_mode" {
  description = "CCE kube-proxy forwarding mode."
  type        = string
  default     = "iptables"

  validation {
    condition     = contains(["iptables", "ipvs"], var.kube_proxy_mode)
    error_message = "kube_proxy_mode must be iptables or ipvs."
  }
}

variable "cluster_tags" {
  description = "Additional CCE resource tags. Use Huawei Cloud resource-tag keys, not Kubernetes label keys."
  type        = map(string)
  default = {
    purpose = "demo"
  }

  validation {
    condition = alltrue([
      for key, value in var.cluster_tags :
      length(key) > 0 &&
      length(key) <= 128 &&
      key == trimspace(key) &&
      !strcontains(key, "/") &&
      !startswith(key, "_sys_") &&
      length(value) <= 255 &&
      (value == "" || value == trimspace(value))
    ])
    error_message = "Each CCE tag key must be 1-128 characters, cannot start or end with whitespace, cannot start with _sys_, and cannot contain /. Tag values must be at most 255 characters and cannot start or end with whitespace unless empty."
  }
}

variable "api_server_eip_name" {
  description = "Name of the new EIP attached to the CCE API Server."
  type        = string
}

variable "api_server_eip_type" {
  description = "EIP line type."
  type        = string
  default     = "5_bgp"
}

variable "api_server_eip_bandwidth_mbps" {
  description = "Dedicated API Server EIP bandwidth in Mbit/s."
  type        = number
  default     = 10

  validation {
    condition     = var.api_server_eip_bandwidth_mbps > 0
    error_message = "api_server_eip_bandwidth_mbps must be positive."
  }
}

variable "worker_node_name" {
  description = "Name of the first CCE worker node."
  type        = string
}

variable "worker_node_flavor_id" {
  description = "ECS flavor ID for the CCE worker node, selected from the target AZ."
  type        = string
}

variable "worker_node_os" {
  description = "CCE node OS value supported in the selected region, for example Ubuntu 22.04."
  type        = string
  default     = "Ubuntu 22.04"
}

variable "worker_node_key_pair" {
  description = "Existing Huawei Cloud key-pair name. Set exactly one of worker_node_key_pair or worker_node_password."
  type        = string
  default     = null
  nullable    = true
}

variable "worker_node_password" {
  description = "Demo/Test node password. Put it in the ignored secrets.auto.tfvars file; never commit it."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true

  validation {
    condition     = (var.worker_node_key_pair != null) != (var.worker_node_password != null)
    error_message = "Set exactly one of worker_node_key_pair or worker_node_password."
  }
}

variable "worker_node_root_volume" {
  description = "Root disk configuration for the CCE worker node."
  type = object({
    size       = number
    volumetype = string
  })
  default = {
    size       = 50
    volumetype = "SAS"
  }
}

variable "worker_node_data_volumes" {
  description = "Data disks for the CCE worker node."
  type = list(object({
    size       = number
    volumetype = string
  }))
  default = [{
    size       = 100
    volumetype = "SAS"
  }]
}

variable "enable_worker_node_eip" {
  description = "Whether CCE should allocate a node EIP for Demo/Test SSH or NodePort access."
  type        = bool
  default     = true
}

variable "worker_node_eip_type" {
  description = "Worker-node EIP line type when enable_worker_node_eip is true."
  type        = string
  default     = "5_bgp"
}

variable "worker_node_eip_bandwidth_mbps" {
  description = "Worker-node EIP bandwidth in Mbit/s when enable_worker_node_eip is true."
  type        = number
  default     = 5

  validation {
    condition     = var.worker_node_eip_bandwidth_mbps > 0
    error_message = "worker_node_eip_bandwidth_mbps must be positive."
  }
}

variable "worker_node_labels" {
  description = "Optional Kubernetes labels assigned to the worker node."
  type        = map(string)
  default     = {}
}

variable "manage_snat" {
  description = "Whether to create a public NAT gateway, a dedicated SNAT EIP, and an SNAT rule for target_subnet_id."
  type        = bool
  default     = false
}

variable "nat_gateway_name" {
  description = "Name for the Terraform-created public NAT gateway."
  type        = string
  default     = "onyxclaw-demo-nat"
}

variable "nat_gateway_spec" {
  description = "Public NAT Gateway specification: 1 (small), 2 (medium), 3 (large), or 4 (extra-large)."
  type        = string
  default     = "1"

  validation {
    condition     = contains(["1", "2", "3", "4"], var.nat_gateway_spec)
    error_message = "nat_gateway_spec must be 1, 2, 3, or 4."
  }
}

variable "snat_eip_name" {
  description = "Name for the dedicated SNAT EIP."
  type        = string
  default     = "onyxclaw-demo-snat"
}

variable "snat_eip_bandwidth_mbps" {
  description = "Bandwidth in Mbit/s for the dedicated SNAT EIP."
  type        = number
  default     = 10
}

variable "manage_sfs" {
  description = "Whether to create and manage an SFS Turbo file system and its dedicated security group."
  type        = bool
  default     = false
}

variable "sfs_name" {
  description = "Name for the Terraform-created SFS Turbo file system."
  type        = string
  default     = "sfs-onyxclaw-demo"
}

variable "sfs_size_gb" {
  description = "SFS Turbo capacity in GB. PERFORMANCE and STANDARD require at least 500 GB."
  type        = number
  default     = 500
}

variable "sfs_share_type" {
  description = "SFS Turbo share type. The tested demo profile uses PERFORMANCE."
  type        = string
  default     = "PERFORMANCE"
}

variable "sfs_security_group_name" {
  description = "Name for the dedicated SFS Turbo security group."
  type        = string
  default     = "sg-onyxclaw-sfs"
}
