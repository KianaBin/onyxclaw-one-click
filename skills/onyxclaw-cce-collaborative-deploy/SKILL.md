---
name: onyxclaw-cce-collaborative-deploy
description: "编排本仓库路径 A 的 OnyxClaw CCE + AgentSphere 人机协作部署：识别 Terraform、人工控制台、配置向导、部署与验收所处阶段，在授权闸门收集非敏感证据并停止等待。仅用于需要 Agent 与操作者共同推进路径 A 的部署。"
---

# OnyxClaw CCE 协作部署

让 Agent 和操作者共同推进本仓库的**路径 A：Terraform + Agent** 部署闭环。这个 skill 是协作状态机：它识别当前阶段、
说明下一步归属、收集可安全呈现的证据，并在需要人工决定或控制台操作时停止。

它不取代以下权威入口：

- `iac/cce/`：Terraform 基础设施定义；
- `scripts/onyxclaw-cce-setup-wizard.sh`：操作者的控制台边界、最小配置录入和预检；
- `scripts/deploy.mjs` / `scripts/deploy.sh`：唯一 Kubernetes 写入口；
- `docs/AGENT_DEPLOYMENT.md`：部署权限、证据和停止条件。

## 开始与恢复

1. 完整阅读仓库 `AGENTS.md` 与 `docs/AGENT_DEPLOYMENT.md`；路径 A 还阅读 `iac/cce/README.md`。以这些文件和当前云端/工作区证据为准，不把历史对话当作现状。
2. 先报告协作状态：**已验证证据**、**当前阶段**、**下一步及负责人**、**阻塞项或所需授权**。未验证项必须明确标为未验证。
3. 保留工作树和本地配置。不要读取、打印、复制或要求操作者在聊天中粘贴 AK/SK、节点密码、kubeconfig 内容或 API Key。

## 协作路径

### 1. Terraform 预检与授权闸门（Agent）

在 `iac/cce/` 使用本次明确的输入执行 `terraform init`、针对相关 `.tf` 文件的 `terraform fmt -check`、`terraform validate` 和
`terraform plan -out=<本次唯一 plan 文件>`。不要读取或输出本地 secret/state 文件。

向操作者展示 plan 的非敏感资源增删摘要、路径选择（新建或复用网络）、已知成本/网络影响和 plan 文件名。到此停止；只有操作者明确授权**该具体 plan**后，才可执行 `terraform apply <该 plan 文件>`。

apply 结束后，只整理非敏感 output：VPC/子网、SFS Turbo ID/NFS 共享根路径、NAT/SNAT 状态、CCE 节点与入口相关输出。确认 CCE 节点 Ready；Terraform 成功不等于 APP 已部署。

### 2. 人工控制台边界（操作者）

向操作者给出当前缺口的最小清单，然后等待其完成并报告非敏感结果：

- 从 CCE 下载 kubeconfig 到部署机的受保护位置，只提供其绝对路径；
- 在同一 VPC 创建或确认已启用私网访问的 AgentSphere 网关，并提供私网数据面 URL；
- 创建 OpenClaw Template，并提供 Template ID；
- 确认 Sandbox 子网的 NAT/SNAT 可访问模型 Endpoint，且 SFS Turbo 可用。

不要模拟 AgentSphere 页面操作、猜测未公开 API、扩大 IAM/RBAC 或网络暴露。缺少任一关键结果时，说明缺口并停在此阶段。

### 3. 配置向导与预检（操作者 + wizard）

当上述输入齐全后，请操作者在部署机运行：

```bash
./scripts/onyxclaw-cce-setup-wizard.sh
```

操作者在向导中录入资源 ID/URL、不可变 APP 镜像引用和 API Key；API Key 与 kubeconfig 内容不得进入聊天。向导可在逐项确认后调用既有 SFS 初始化、离线 dry-run、集群只读检查和 server-side dry-run。

操作者只需回报非敏感证据，例如 `SFS_PREPARE_OK`、检查命令是否成功、资源归属冲突、脱敏错误或 CCE 事件。若失败，先按证据定位问题；不要通过放宽安全组、改用公网数据面或跳过校验继续。

### 4. 正式部署授权（Agent + 操作者）

预检通过后，先说明唯一写入口将创建或更新的范围：Namespace、APP/Channel Service、Provider ConfigMap、Secret 和 Deployment，
以及可能由 CCE 托管创建的 ELB。说明 APP 入口模式和公网暴露影响。

只有操作者明确授权正式部署后，调用既有 `./scripts/deploy.sh`。资源冲突、未知 ELB 绑定、目标 context 不符、需要新增权限/网络边界时，停止并让操作者决定；不要手工创建平行 Manifest 或为绕过 collision 检查补标签。

### 5. 验收与收尾（共同）

将结果分为三个状态，不得合并：

| 状态 | 最小证据 |
| --- | --- |
| 基础设施就绪 | CCE 节点 Ready、SFS/NAT-SNAT/网关-Template 前置条件符合输入。 |
| APP 部署成功 | Deployment Ready、不可变 image digest、Service/ELB 与入口模式、`/api/ui-config` 和 DNS/TCP/TLS 检查通过。 |
| 端到端验收成功 | 创建 Sandbox、写入并确认 `SOUL.md`、Channel 回连、模型对话、pause/resume 持久化、按明确 Sandbox ID reset/kill 均有证据。 |

APP Ready 时只能报告“应用部署成功”；在端到端链路完成前不得报告整体完成。清理时只处理操作者明确授权且 ID 已确认的单个对象。
