---
name: onyxclaw-cce-deploy
description: "编排 OnyxClaw 在华为云 CCE 与 AgentSphere 的从前置检查到端到端验收部署。适用于需要复用本仓库现有 Terraform、config 和 scripts 的受控部署；不用于另建部署器或绕过 AgentSphere 控制台步骤。"
---

# OnyxClaw CCE 部署编排

在本仓库中编排一次可审计的部署闭环。Skill 只决定下一步、收集缺口并调用仓库既有入口；基础设施定义、
本地配置和 Kubernetes 写操作的唯一来源分别仍是 `iac/cce/`、`config/` 与 `scripts/`。

## 开始前

1. 找到仓库根目录：其中必须同时存在 `AGENTS.md`、`scripts/deploy.mjs`、`config/config.env.example` 和
   `iac/cce/`。在任何写操作前完整阅读 `AGENTS.md` 与 `docs/AGENT_DEPLOYMENT.md`。
2. 保留现有工作树和本地配置。不要创建第二套 `.env`、YAML、Terraform 或部署脚本；真实密钥、kubeconfig、
   节点密码和 AK/SK 既不输出，也不写入可提交文件。
3. 对空账号或需要新建基础设施的请求，额外阅读 `docs/CLOUD_PREREQUISITES.md` 与 `iac/cce/README.md`。
   AgentSphere 网关和 Template 是人工控制台边界，不能模拟页面操作或臆测 API。

## 编排流程

### 1. 先确定路径和入口

将本次任务归类为一个路径，并说明缺少什么才能继续：

- **已有 CCE**：使用已有 kubeconfig、SFS、私网网关和 Template，跳过 Terraform。
- **空账号且有 AK/SK**：用 `iac/cce/` 生成独立资源的 Terraform plan；只在用户查看具体 plan 并明确授权后才可 apply。
- **空账号但无 AK/SK**：按 `docs/CLOUD_PREREQUISITES.md` 指导用户在控制台完成资源准备，再回到既有 APP 部署流程。

读取根 README 的“APP 浏览器入口与节点 EIP 的对应关系”，让用户明确选择 NodePort 或 `public-elb`。只有用户
明确选择 `APP_ACCESS_MODE=public-elb` 时，才可创建公网 APP ELB；这是公网暴露变更。不要把节点 EIP、API Server
EIP、APP ELB EIP 和 Sandbox SNAT EIP 混为同一资源。

### 2. 处理人工边界和最小输入

用 `./scripts/init.sh` 仅创建缺失的本地配置文件。引导用户只在现有 `config/config.env` 与
`config/secrets.env` 中填写输入：

- `KUBECONFIG`、AgentSphere 私网数据面 URL、Template ID、SFS Turbo ID；
- AgentSphere E2B API Key 与模型 API Key。

在继续前，确认网关已开启私网访问，网关、Template/Sandbox、CCE 与 SFS 位于同一 VPC，且 Sandbox 子网具有
通往模型 Endpoint 的 NAT Gateway + SNAT 出网。Template 创建完成后才接受 Template ID；只记录非敏感的完成状态。

### 3. 运行可逆检查

按此顺序执行并解释每个失败的缺口，不要跳过失败检查：

1. `node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env --dry-run`
2. 若 SFS workspace 未准备，运行 `scripts/prepare-sfs.sh`，以 `SFS_PREPARE_OK` 和 UID/GID `1000` 写权限为通过条件。
3. `./scripts/deploy.sh --check-cluster`
4. `./scripts/deploy.sh --server-dry-run`

Terraform 路径中，先运行 `terraform init`、`terraform fmt -check`、`terraform validate` 和
`terraform plan -out=<本次唯一 plan 文件>`。展示 plan 的资源增删摘要后停止，等待用户对该 plan 明确授权；
`terraform apply` 或 `terraform destroy` 从不因 Skill 调用而自动获得授权。

### 4. 部署与浏览器验收

用户明确要求正式部署后，运行唯一的 Kubernetes 写入口 `./scripts/deploy.sh`。记录但不泄露：APP Service 入口、
Channel 私网 ELB 地址、APP Pod Ready、Provider/Template/Model 的 `/api/ui-config` 结果和 DNS 检查结果。

APP Ready 只代表应用部署完成。请用户在浏览器完成并逐项确认：

1. 点击“进入龙虾模式”创建 Sandbox；
2. 写入并确认 `SOUL.md`；
3. 等待 Channel 回连并完成一轮模型对话；
4. pause/resume 后确认同一 Sandbox 与 SOUL 状态仍在；
5. reset/kill 后按明确 Sandbox ID 确认清理。

将结果分为“基础设施”“应用部署”“端到端验收”三类；任何一类未完成都要明确标记，而不能宣称全流程通过。

## 停止与收尾

- 新增 IAM/RBAC、网络暴露、安全组、AgentSphere Template 变更或未知既有资源冲突时，说明精确影响并等待用户决定。
- 清理先在 APP 内 reset 明确的 Sandbox；云资源只处理用户明确授权且 ID 已确认的单个对象。Terraform 清理同样先生成
  destroy plan、展示摘要并取得授权。
- 最终报告给出：所选路径、入口模式、已验证证据、未完成项、相关资源 ID/地址的非敏感摘要，以及下一步或清理建议。
