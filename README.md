# OnyxClaw：CCE + AgentSphere 一键部署包

此交付包把 OnyxClaw Cloud APP 部署到目标用户自己的华为云 CCE，并让 APP 通过
AgentSphere 创建、管理 OpenClaw Sandbox。它从“云资源和人工 Template 已准备好”开始，自动完成
Kubernetes 资源部署、Channel 私网 ELB 接线、运行时 DNS 校验和 APP 配置校验。

完整端到端能力为：创建 Sandbox → 写入并持久化 `SOUL.md` → Channel 回连 → 模型对话 →
pause/resume → kill。

## 先看这里：选择你的路径

| 你是谁 | 先读什么 | 接下来做什么 |
| --- | --- | --- |
| 人类部署者 | [云资源前置条件](./docs/CLOUD_PREREQUISITES.md) | 按 [人工部署与使用](./docs/HUMAN_DEPLOYMENT.md) 初始化、填写配置、部署和验收。 |
| AI Agent | [AGENTS.md](./AGENTS.md) | 继续完整阅读 [Agent 部署 Runbook](./docs/AGENT_DEPLOYMENT.md)，仅在用户明确授权后部署。 |
| 已部署、需要对照 | [稳定基线](./docs/references/CURRENT_DEMO_BASELINE.md) | 对照镜像、网络、Service、SFS 与生命周期关键项。 |
| 想了解空账号实测过程 | [空账号自测记录](./docs/references/NEW_ACCOUNT_VALIDATION.md) | 作为经验参考，不复制其中的资源 ID 或环境值。 |

## 前置条件

以下项目由目标用户在华为云控制台或模型服务商侧准备；脚本不会购买资源、创建 AgentSphere
Template，或扩大网络/IAM 权限。

1. **账号与区域**：已开通 CCE、SWR、SFS Turbo、AgentSphere 的同一华为云账号和 Region；推荐使用
   `cn-south-1`。
2. **网络**：同一个 VPC/子网中的 CCE、AgentSphere 智能体网关、Template/Sandbox 与 SFS Turbo。
   网关必须开启私网访问；Sandbox 所在子网需要 NAT Gateway + SNAT，供其访问 DeepSeek 等公网模型。
3. **CCE**：至少一个 Ready 工作节点；从 CCE 控制台导出 kubeconfig，并在部署机本地用 `kubectl` 验证
   指定 context 可访问集群。
4. **SFS Turbo**：已创建文件系统，取得文件系统 ID 与 NFS 共享根路径；使用本包脚本创建并验证
   `/onyxclaw/workspace` 对 UID/GID `1000` 可写。
5. **AgentSphere**：已创建（或正确配置系统默认）智能体网关，取得其私网数据面 URL；已把稳定
   OpenClaw 镜像复制到目标租户 SWR，并在控制台创建 Template、关联网关、记录 Template ID。
6. **模型和密钥**：用户自行申请 AgentSphere E2B API Key、DeepSeek（或所选 Provider）API Key。
   这两项只保存在本地 `config/secrets.env`，绝不提交或分享。

创建顺序、控制台填写项、网络说明与华为云官方链接都在
[云资源前置条件](./docs/CLOUD_PREREQUISITES.md)。

## 目录说明

| 目录/文件 | 职责 |
| --- | --- |
| `docs/` | 面向人和 Agent 的流程文档。 |
| `docs/references/` | 已验证稳定基线及空账号自测记录，仅作对照。 |
| `scripts/` | 唯一的初始化、SFS 准备和 Kubernetes 部署实现。 |
| `config/` | 可提交的示例配置，以及本地生成的敏感配置文件。 |
| `tests/` | 部署器与 SFS 准备脚本的离线测试。 |
| `assets/` | AgentSphere 网关与 Template 控制台示意图。 |
| `AGENTS.md` | 给自动化 Agent 的入口与安全边界。 |


## 最短人工路径

在本目录执行：

```bash
# 初始化配置文件
./scripts/init.sh
# 手动编辑 config/config.env、config/secrets.env、config/openclaw-base-config.json
# dry-run 检查
node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env --dry-run
# 检查集群状态
./scripts/deploy.sh --check-cluster
./scripts/deploy.sh --server-dry-run
# 实际部署
./scripts/deploy.sh
```

首次使用新 namespace 时，`--server-dry-run` 会根据 `NAMESPACE` 创建该 namespace，然后仅让 CCE API
Server 校验其他资源；真正部署由最后一条命令执行。部署命令会等待 APP Ready，并从 APP Pod 验证
AgentSphere 控制面与私网数据面 DNS；出现 `DNS_ERROR` 时应先修复网络，不要继续在页面创建 Sandbox。

配置字段含义、ELB 自动创建行为、使用页面和完整验收标准，请按
[人工部署与使用](./docs/HUMAN_DEPLOYMENT.md) 执行。
