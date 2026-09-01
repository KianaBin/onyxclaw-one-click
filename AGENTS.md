# OnyxClaw CCE + AgentSphere：Agent 入口

当用户要求检查、部署、更新、验证或排障此交付包时，先完整阅读
[`docs/AGENT_DEPLOYMENT.md`](./docs/AGENT_DEPLOYMENT.md)。它定义了所需输入、密钥处理、只读预检、
唯一写入口、验收证据与停止条件。

支持 Skill 的 Agent 可额外使用 [`skills/onyxclaw-cce-deploy/SKILL.md`](./skills/onyxclaw-cce-deploy/SKILL.md)
编排完整部署闭环；该 Skill 只能调用本仓库已有入口，不能成为第二套配置或写操作路径。

若目标是全新华为云账号或空环境，先完整阅读
[`docs/CLOUD_PREREQUISITES.md`](./docs/CLOUD_PREREQUISITES.md)，并将其中的云资源创建和 Template
控制台步骤视为人工边界；其中 VPC、CCE、NAT/SNAT 与 SFS 也可按 `iac/cce/` 的显式 plan 受控创建，
但不要模拟 AgentSphere 页面操作或臆测未公开 API。

目录职责：

- `config/`：示例及本地生成配置。真实 kubeconfig、API Key、`config.env`、`secrets.env`、
  `openclaw-base-config.json` 均不得提交、打印或回显。
- `scripts/`：唯一执行入口。Kubernetes 写操作只能经 `scripts/deploy.mjs`；不得另建 YAML 或平行部署器。
- `iac/cce/`：可选 Terraform 路径。默认从零创建 VPC/子网；设置 `network_mode = "existing"` 后可只使用已有
  VPC/子网 ID，并创建 CCE、EIP、可选 NAT/SNAT 与 SFS Turbo。已有网络只作为输入，不纳入 state；它不管理
  Kubernetes APP、AgentSphere，也不生成或输出 kubeconfig。执行 `apply` 或 `destroy` 前，必须向用户展示并取得其对
  具体 plan 的授权。
- `docs/references/`：稳定基线和空账号实测记录，仅用于比较，不可复用其中的资源 ID、网络地址或账号配置。

APP Ready 只代表 CCE 部署成功，不代表端到端完成。只有 Sandbox 创建、SOUL 写入、Channel 回连、模型对话、
pause/resume 以及 kill/reset 都有证据时，才可报告完整验收通过。

不得批量删除文件、目录、namespace、ELB、SFS、CCE 资源或 Sandbox。清理只处理用户明确授权且 ID 已明确的
单个对象。
