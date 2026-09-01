# Terraform：基础设施与 CCE

此模块提供一条与控制台手工流程等价的 IaC 路径。默认从零创建独立 VPC 与子网；若已有用于 AgentSphere 或 SFS 的
VPC/子网，也可设置 `network_mode = "existing"`，在该网络中创建 CCE。它可创建：

- VPC 与子网（仅 `network_mode = "create"`）；
- CCE Standard 集群、API Server 专用 EIP、一个 containerd 节点及可选节点 EIP；
- 公网 NAT Gateway、专用 SNAT EIP 与目标子网的 SNAT 规则（`manage_snat = true`）；
- 带专用安全组的 NFS SFS Turbo（`manage_sfs = true`）；

它不创建 AgentSphere 网关或 Template：这些步骤仍须按控制台流程完成。它也不会下载 kubeconfig；集群创建后由
操作者从 CCE 控制台下载公网 kubeconfig。创建 Template 时，在“选择镜像”直接填写固定的公开 OpenClaw tag；无需
创建目标租户 SWR 仓库、复制镜像或填写 `image@sha256`。

## 运行前准备

1. 选择目标 AZ，并选择网络模式：新环境使用 `create`，已有 VPC/子网使用 `existing`。无论哪种模式，Pod、Service
   与 VPC 网段均不得重叠。
2. 安装 Terraform `1.6+`。将 `secrets.auto.tfvars.example` 复制为 `secrets.auto.tfvars`，填写 AK、SK 和（如使用
   密码登录）节点密码，并设置文件权限为 `600`。真实文件被 Git 忽略，绝不提交。
3. 确认目标 Region/AZ 实际提供的 CCE 版本、集群规格、节点 ECS 规格、节点操作系统值与磁盘类型。
   `terraform.tfvars.example` 中的值仅是 Demo/Test 起点，不保证跨 Region 可用。
4. 可使用已有密钥对，或在 `secrets.auto.tfvars` 中配置密码登录；二者必须且只能选择一个。

华为云 CCE provider 会返回与 Kubernetes 凭据相关的集群属性。即使本模块不会输出 kubeconfig，也应将整个
Terraform state 视为敏感数据；在个人 Demo/Test 账号以外使用前，应配置受保护的远端 state backend。

`cluster_tags` 用于华为云资源标签，不是 Kubernetes labels。CCE 标签键不能包含 `/` 等保留字符；应使用
`app = "onyxclaw"`、`managed_by = "terraform"` 等键，不要使用 `app.kubernetes.io/part-of`。

## 执行 Terraform

```bash
cd iac/cce
cp terraform.tfvars.example terraform.tfvars
cp secrets.auto.tfvars.example secrets.auto.tfvars
chmod 600 secrets.auto.tfvars
# 编辑两个本地文件。它们均被 Git 忽略。

terraform init
terraform fmt -check
terraform validate
terraform plan -out=cce.plan
terraform apply cce.plan
terraform output
```

不再需要每次 `export`。保留环境变量认证作为 provider 的兼容回退方式，但不推荐作为本模块的日常使用方式。

### 复用已有 VPC/子网

已有 VPC、子网、SFS Turbo、AgentSphere 私网网关或 Template，但尚未创建 CCE 时，使用下列最小网络配置：

```hcl
network_mode       = "existing"
existing_vpc_id    = "<已有 VPC ID>"
existing_subnet_id = "<已有子网 ID>"

# 已有 SFS 时保持 false；其文件系统 ID 稍后填写到 config/config.env。
manage_sfs = false

# 已有 NAT/SNAT 时保持 false；尚未配置 Sandbox 出网时设为 true。
manage_snat = true
```

该模式不会读取、import 或管理已有 VPC/子网；它们不会出现在 Terraform state 中，`terraform destroy` 也不会删除它们。
当 `manage_sfs = false` 时，已有 SFS 同样不由本模块管理。`manage_snat = true` 会在指定的已有 VPC/子网中新建
NAT Gateway、SNAT EIP 与规则；若这些出网资源已存在，则保持 `false`，避免重复创建。

`network_mode = "create"`（默认）不应填写 `existing_vpc_id` 或 `existing_subnet_id`；模块会在 plan 前报出明确错误，
防止误把两种模式混用。

若本地 `terraform.tfvars` 来自本模块的早期版本，删除其中的 `vpc_id`、`subnet_id`、`write_app_config`、
`app_config_path`、`app_kubeconfig_path`、`app_namespace`、`agentsphere_sandbox_url` 与 `agentsphere_template_id`。
请改用 `existing_vpc_id`、`existing_subnet_id`；本模块不管理 APP 配置。

apply 后保存 outputs 作为部署记录。等待节点为 Active 后，从 CCE 控制台下载 API Server 公网 kubeconfig，
设置权限为 `600`，再用 `kubectl get nodes` 验证节点状态。

Terraform 不读取、生成或覆盖 `config/config.env`、`config/secrets.env` 或 OpenClaw JSON。完成 apply 并下载
kubeconfig 后，操作者必须运行 `scripts/init.sh`，在唯一的 `config/` 配置入口手动填写 Terraform 输出的 Region、
SFS Turbo ID/NFS 根路径，以及 AgentSphere 网关 URL 和 Template ID。

### Demo/Test 预检与常见恢复路径

- 若要通过节点公网 IP 的 `NodePort 30080` 打开 APP，设置 `enable_worker_node_eip = true`，并预留 API Server、
  SNAT、节点三条 EIP 配额。若节点无法绑定 EIP，设为 `false`，后续在唯一的 `config/config.env` 设置
  `APP_ACCESS_MODE=public-elb`；APP 部署脚本会让 CCE 自动创建公网 ELB 并申请、绑定它自己的 EIP。该 EIP 不由
  Terraform 管理，仍应预留 API Server、SNAT、APP ELB 三条 EIP 配额。仅运行 kubectl 或使用 port-forward 时可设为
  `false` 且不启用公网 APP ELB。

| APP 浏览器入口 | `APP_ACCESS_MODE` | `enable_worker_node_eip` |
| --- | --- | --- |
| 节点 EIP + NodePort `30080`（默认） | 不填写（默认 `nodeport`） | `true` |
| APP 公网 ELB + EIP | `public-elb` | 通常 `false` |

即使使用 APP 公网 ELB，仍可为了直接 SSH 调试而设置 `enable_worker_node_eip = true`；但它不是 APP 访问的要求，
会额外申请节点 EIP。
- 给 `sfs_name` 设置当前账号中未使用的名称；SFS Turbo 的同名创建会发生冲突。
- apply 部分成功时，保留 state 和已创建资源；修复单个输入后重新生成 plan。例如：

  ```bash
  terraform plan -out=cce-retry.plan
  terraform apply cce-retry.plan
  ```

  不要重新使用部分 apply 之前生成的旧 plan。

## 继续部署 OnyxClaw APP

后续 APP 部署仍使用项目原有脚本：

```bash
# 在交付包根目录执行
./scripts/prepare-sfs.sh ...
./scripts/deploy.sh --check-cluster
./scripts/deploy.sh --server-dry-run
./scripts/deploy.sh
```

在最终部署前完成 AgentSphere 私网网关、使用固定公开 OpenClaw 镜像创建 Template，并填写两个 API Key。详细步骤见
[云资源前置条件](../../docs/CLOUD_PREREQUISITES.md)和[人工部署与使用](../../docs/HUMAN_DEPLOYMENT.md)。

## 生命周期与清理

`terraform destroy` 不应作为日常测试命令。当 IaC 模式创建网络、NAT 或 SFS 时，它也会尝试删除同一 state 中由它创建的
资源。`network_mode = "existing"` 的 VPC/子网和 `manage_sfs = false` 的已有 SFS 不在 state 中，不属于 destroy 范围。
先在 APP 内 reset 本次 Sandbox，并删除本次测试 namespace 中的 APP 对象；再检查
`terraform plan -destroy -out=destroy.plan`，只销毁用户明确授权且独立的 Demo/Test 资源，最后执行
`terraform apply destroy.plan`。AgentSphere 网关与 Template 不由 Terraform 管理，需在控制台单独删除。
