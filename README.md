# OnyxClaw：CCE + AgentSphere 从零部署包

本包把 OnyxClaw Cloud APP 部署到华为云 CCE，并让 APP 借助 AgentSphere 创建、管理 OpenClaw Sandbox。
它覆盖从空账号资源准备到浏览器端端到端验收的完整闭环；当前固定支持华南-广州 `cn-south-1`。

完整验收链路是：创建 Sandbox → 写入并持久化 `SOUL.md` → Channel 回连 → DeepSeek 模型对话 →
pause/resume → reset/kill 清理。

## 总览

先用本节确认交付目标、网络边界和验收标准；再到“部署路径与步骤”选择路径并逐步执行；最后按“导航与说明”进入细节手册。

### 架构与网络拓扑

![OnyxClaw CCE + AgentSphere 部署架构与网络拓扑](./assets/onyxclaw-cce-agentsphere-architecture.visual-check.1440x900.light.png)

拓扑的关键约束说明如下：

- CCE、智能体网关、Template/Sandbox 与 SFS Turbo 必须在同一 VPC；网关必须开启私网访问。
- APP 对 AgentSphere 的调用分为两条并行链路：**控制面**只处理 Sandbox 的创建、暂停、恢复与删除；
  **私网数据面**处理 `exec`、文件读写等运行时请求。
- APP 页面默认使用节点 EIP 上的 NodePort `30080`；无法绑定节点 EIP 时，可在首次部署前设置
  `APP_ACCESS_MODE=public-elb`，由 CCE 自动创建公网 ELB 并申请、绑定 APP 专用 EIP。Channel 始终由 CCE
  自动创建私网 ELB，监听 `18890/TCP`，Sandbox 通过 WebSocket 回连。
- Sandbox 访问 DeepSeek 等公网模型只能走其所在子网的 NAT Gateway + SNAT；节点公网 EIP 不能代替 SNAT EIP。
- SFS Turbo 挂载固定 workspace，保存 `SOUL.md` 等状态。

APP 浏览器入口与节点 EIP 的对应关系说明：

| 浏览器访问方式 | `config/config.env` | `iac/cce/terraform.tfvars` | 浏览器地址 |
| --- | --- | --- | --- |
| 默认：节点 EIP + NodePort | 不填写 `APP_ACCESS_MODE`（默认 `nodeport`） | `enable_worker_node_eip = true` | `http://<node-eip>:30080` |
| 可选：APP 公网 ELB + EIP | `APP_ACCESS_MODE=public-elb` | 通常 `enable_worker_node_eip = false` | 部署输出的 `http://<elb-eip>` |

公网 ELB 模式下，EIP 绑定到 APP 的 ELB，而不是工作节点。只有还要直接 SSH 到节点排障时，才在公网 ELB
模式下保留 `enable_worker_node_eip = true`；这会额外占用一条 EIP 配额。无论选择哪种浏览器入口，API Server
EIP 与 Sandbox 的 SNAT EIP 都仍是独立且必需的资源。

## 部署路径与步骤

### 1. 选择部署路径

三条路径最终都使用同一个 `config/`、`scripts/` 和验收流程。不同之处仅在云资源由谁创建。

| 你的条件 | 推荐路径 | AI Agent 负责 | 人工必须完成 |
| --- | --- | --- | --- |
| 有华为云 AK/SK，且可使用 AI Agent | **最快自动化路径** | 通过 Terraform 新建或复用已有 VPC/子网，创建 CCE、节点/EIP、可选 NAT/SNAT 与 SFS；预检、准备 SFS、部署 APP、收集验收证据。 | 在本地安全提供 AK/SK、节点登录方式并审阅 Terraform plan；从 CCE 下载 kubeconfig；在 AgentSphere 控制台创建私网网关和 Template；填写 4 项环境信息与 2 个 API Key。若节点不能绑定 EIP，选择 APP 的公网 ELB 入口。 |
| 没有 AK/SK，但可使用 AI Agent | **半自动路径** | 根据本包手册检查人工创建的资源，执行 kubeconfig/RBAC 预检、SFS 准备、APP 部署、运行时 DNS 检查与验收辅助。 | 在华为云控制台创建 VPC、CCE、NAT/SNAT、SFS；下载 kubeconfig；创建私网网关和 Template；填写本地配置与密钥。 |
| 没有 AK/SK，也没有 AI Agent | **人工路径** | 不适用。 | 按控制台手册创建云资源，按部署手册执行脚本、打开 APP，并完成全部验收。 |

AI Agent 可以是 Codex 或其他能读取仓库文件、运行 Terraform / Node.js / kubectl 的 Agent。所有 Agent 都应先阅读
[AGENTS.md](./AGENTS.md) 和 [Agent 部署 Runbook](./docs/AGENT_DEPLOYMENT.md)。人工操作者可使用本包的
[CCE + AgentSphere 配置向导](./scripts/onyxclaw-cce-setup-wizard.sh)，以现有配置和脚本推进控制台边界与安全预检。AK/SK、
kubeconfig、节点密码和 API Key 只能保存在本地受保护文件或凭据环境中，不能提交、粘贴进聊天或写入 Terraform plan。

### 2. Terraform 路径与配置向导的先后顺序

`onyxclaw-cce-setup-wizard.sh` **不执行** Terraform `init`、`plan` 或 `apply`，也不执行正式 APP 部署。选择 Terraform
路径时，按以下顺序推进；不要在完成前置资源之前把向导当作 Terraform 的替代品：

1. 在 `iac/cce/` 填写本地受保护的 Terraform 输入，执行 `terraform init`、`terraform fmt -check`、`terraform validate` 和
   `terraform plan -out=<本次 plan 文件>`。
2. 人工审阅该具体 plan，并明确授权后才执行 `terraform apply <本次 plan 文件>`。
3. 从 Terraform output 记录 VPC/子网、SFS Turbo ID、NFS 共享根路径及 NAT/SNAT 状态；确认 CCE 工作节点为 Ready。
4. 从 CCE 控制台下载 kubeconfig 到部署机的受保护位置；只把其**绝对路径**交给后续向导，不复制其内容。
5. 在 AgentSphere 控制台创建或确认同 VPC、已开启私网访问的网关，并创建 OpenClaw Template；记录私网数据面 URL 和 Template ID。
6. 运行 `./scripts/onyxclaw-cce-setup-wizard.sh`：向导录入最小配置和 API Key，并在逐项确认后执行 SFS 初始化、离线 dry-run、集群只读检查及 server-side dry-run。
7. 仅当预检结果符合预期并且操作者明确决定部署时，单独执行 `./scripts/deploy.sh`，再完成浏览器端到端验收。

控制台手工路径无需 Terraform：先按 [云资源前置条件](./docs/CLOUD_PREREQUISITES.md) 创建同等资源，再从上述第 4 步进入。

### 3. 通用部署闭环

无论选择哪条路径，都按下列阶段推进。每一阶段的输出就是下一阶段的输入。

| 阶段 | 完成动作 | 继续条件 / 输出 |
| --- | --- | --- |
| 1. 选择路径与权限 | 选择上表路径；确认账号已开通 CCE、SFS Turbo、AgentSphere，且 Region 为 `cn-south-1`。 | 快速路径还需本地可用 AK/SK；其余路径按控制台权限执行。 |
| 2. 创建基础设施 | 通过 Terraform 或控制台创建同一 VPC/子网中的 CCE、工作节点、NAT/SNAT 和 SFS Turbo；Terraform 可新建网络，也可复用已有网络。Terraform 路径必须先审阅具体 plan、获授权并完成 `apply`。选择 APP 的浏览器入口。 | 节点为 Ready；Sandbox 子网可经 SNAT HTTPS 出网；取得 SFS ID 与 NFS 根路径。NodePort 需要节点 EIP；公网 ELB 由部署脚本后续创建并绑定 EIP。 |
| 3. 完成人工控制台边界 | 从 CCE 下载 kubeconfig；在 AgentSphere 创建开启私网访问的网关；在同 VPC 创建 Template。 | 得到 kubeconfig、网关私网数据面 URL、Template ID。Template 的“选择镜像”直接填写固定公开 OpenClaw tag。 |
| 4. 填写本地输入 | 运行 `./scripts/onyxclaw-cce-setup-wizard.sh`，由它调用既有 `scripts/init.sh` 并收集最小输入。 | `config/config.env` 填 4 项环境信息、入口模式与不可变 `APP_IMAGE`；`config/secrets.env` 填 2 个 API Key。向导不执行 Terraform 或正式部署。 |
| 5. 准备与部署 | 向导可在确认后初始化 SFS workspace 并执行离线检查、集群预检和 server dry-run；预检通过后，操作者单独执行 `./scripts/deploy.sh`。 | `SFS_PREPARE_OK`；APP Pod Ready；控制面和网关私网数据面 DNS 均可解析。 |
| 6. 页面端到端验收 | 浏览器打开 APP，点击“进入龙虾模式”，进行对话、pause/resume 与 reset。 | Sandbox 创建、Channel 回连、模型回复、SFS 持久化与清理均有证据。 |
| 7. 清理或保留 | 先在 APP reset Sandbox；再明确选择保留或按资源 ID 释放云资源。 | 不批量删除；Terraform 创建的资源先审阅 destroy plan。 |

#### 路径 A：最快自动化（AK/SK + AI Agent）

1. 让 Agent 阅读 [AGENTS.md](./AGENTS.md)、[Terraform 模块](./iac/cce/README.md) 和
   [Agent 部署 Runbook](./docs/AGENT_DEPLOYMENT.md)。
2. 在本地受保护的 `iac/cce/secrets.auto.tfvars` 或受控环境变量中提供 AK/SK，并配置节点密钥对或节点密码；
   生成后人工审阅 `terraform plan`，再明确授权 Agent 执行 `apply`。
3. `apply` 成功后，人工从 CCE 下载 kubeconfig，并在 AgentSphere 控制台完成同 VPC、已开启私网访问的网关和 Template。
4. 人工运行 `./scripts/onyxclaw-cce-setup-wizard.sh`，录入 Terraform/控制台输出和两把 API Key，并确认 SFS 与三项预检。
5. 预检通过后，操作者明确决定是否执行 `./scripts/deploy.sh`；Agent 不得自行扩大 IAM、网络暴露或模拟 AgentSphere 控制台操作。

#### 路径 B：半自动（无 AK/SK + AI Agent）

1. 人工完整阅读 [云资源前置条件](./docs/CLOUD_PREREQUISITES.md)，在控制台完成阶段 2–3。
2. 运行 `./scripts/onyxclaw-cce-setup-wizard.sh`，将 kubeconfig 的本地绝对路径、网关私网数据面 URL、Template ID、SFS ID 和两个 API Key 写入唯一的本地 `config/`，并确认 SFS 与预检步骤。
3. 预检通过且用户明确决定后，让 Agent 通过 [Agent 部署 Runbook](./docs/AGENT_DEPLOYMENT.md) 的唯一入口部署并协助验收取证。

#### 路径 C：人工部署（无 AK/SK + 无 AI Agent）

1. 依次执行 [云资源前置条件](./docs/CLOUD_PREREQUISITES.md) 与 [人工部署与使用](./docs/HUMAN_DEPLOYMENT.md)。
2. 脚本的唯一写入口是 `scripts/deploy.mjs` / `scripts/deploy.sh`；不要另建平行 Kubernetes Manifest。
3. 按阶段 6 的标准在页面完成全部功能验收。

### 4. 配置与部署命令

所有路径共用同一份最小配置。完成 CCE、SFS、网关和 Template 前置条件后，推荐先运行向导；它会在正式部署前停止：

```bash
./scripts/onyxclaw-cce-setup-wizard.sh

# 仅在向导的 SFS/预检结果符合预期、且操作者明确决定部署后执行：
./scripts/deploy.sh
```

如不使用向导，才按以下手工方式填写同一份配置并执行相同的既有入口：

```bash
./scripts/init.sh
# 编辑 config/config.env：KUBECONFIG、网关私网 URL、Template ID、SFS Turbo ID、APP_IMAGE
# 编辑 config/secrets.env：AgentSphere E2B API Key、DeepSeek API Key

# SFS 已创建后，使用控制台提供的 NFS 共享根路径初始化 workspace
./scripts/prepare-sfs.sh \
  --kubeconfig /absolute/path/to/cce-kubeconfig.yaml \
  --nfs-endpoint 192.168.x.x:/

# 离线检查 → 集群预检 → 首次部署前的 API Server 校验 → 正式部署
node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env --dry-run
./scripts/deploy.sh --check-cluster
./scripts/deploy.sh --server-dry-run
./scripts/deploy.sh
```

默认使用 kubeconfig 的 `current-context`，只有一个文件含多个集群时才在 `config/config.env` 增加可选
`KUBE_CONTEXT`。首次 `--server-dry-run` 会创建默认 namespace `onyxclaw`，但不会持久化其他对象。

## 导航与说明

### 文档导航

| 需要了解的内容 | 入口 |
| --- | --- |
| 云资源创建顺序、控制台填写项、官方文档链接 | [云资源前置条件](./docs/CLOUD_PREREQUISITES.md) |
| Terraform 新建/复用网络并创建 CCE、NAT/SNAT、SFS | [Terraform 基础设施与 CCE](./iac/cce/README.md) |
| 人工部署命令、页面使用与完整验收 | [人工部署与使用](./docs/HUMAN_DEPLOYMENT.md) |
| 供任意 AI Agent 执行的安全边界、证据和停止条件 | [Agent 部署 Runbook](./docs/AGENT_DEPLOYMENT.md) |
| 路径 A 的 Terraform、人工边界、授权和验收协作 | [OnyxClaw CCE 协作部署 Skill](./skills/onyxclaw-cce-collaborative-deploy/SKILL.md) |
| 人工控制台边界、最小配置录入与安全预检 | [CCE + AgentSphere 配置向导](./scripts/onyxclaw-cce-setup-wizard.sh) |
| 当前稳定镜像和关键运行时约束 | [稳定基线](./docs/references/CURRENT_DEMO_BASELINE.md) |
| 空账号实际验证的经验与故障案例 | [空账号自测记录](./docs/references/NEW_ACCOUNT_VALIDATION.md) |

### 目录职责

| 目录 | 职责 |
| --- | --- |
| `iac/cce/` | 可选 Terraform 基础设施模块；不管理 AgentSphere 网关/Template 或 APP 配置。 |
| `config/` | 可提交的示例与本地生成的敏感配置；真实文件不会提交。 |
| `scripts/` | 唯一的 SFS 准备和 Kubernetes 部署入口。 |
| `docs/` | 面向人工部署者和 AI Agent 的分路径手册。 |
| `docs/references/` | 已验证基线与空账号实测记录，只用于对照。 |
| `tools/agentsphere-openclaw-sandbox/` | 可选的 AgentSphere Sandbox 镜像重建与交互诊断工具；不参与默认一键部署，也不替换当前稳定 Template 镜像。 |
| `assets/` | 架构图与 AgentSphere 控制台示意图。 |
