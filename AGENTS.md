# OnyxClaw CCE + AgentSphere：Agent 入口

当用户要求检查、部署、更新、验证或排障此交付包时，先完整阅读
[`docs/AGENT_DEPLOYMENT.md`](./docs/AGENT_DEPLOYMENT.md)。它定义了所需输入、密钥处理、只读预检、
唯一写入口、验收证据与停止条件。

若目标是全新华为云账号或空环境，先完整阅读
[`docs/CLOUD_PREREQUISITES.md`](./docs/CLOUD_PREREQUISITES.md)，并将其中的云资源创建和 Template
控制台步骤视为人工边界；不要模拟页面操作或臆测未公开 API。

目录职责：

- `config/`：示例及本地生成配置。真实 kubeconfig、API Key、`config.env`、`secrets.env`、
  `openclaw-base-config.json` 均不得提交、打印或回显。
- `scripts/`：唯一执行入口。Kubernetes 写操作只能经 `scripts/deploy.mjs`；不得另建 YAML 或平行部署器。
- `docs/references/`：稳定基线和空账号实测记录，仅用于比较，不可复用其中的资源 ID、网络地址或账号配置。

APP Ready 只代表 CCE 部署成功，不代表端到端完成。只有 Sandbox 创建、SOUL 写入、Channel 回连、模型对话、
pause/resume 以及 kill/reset 都有证据时，才可报告完整验收通过。

不得批量删除文件、目录、namespace、ELB、SFS、CCE 资源或 Sandbox。清理只处理用户明确授权且 ID 已明确的
单个对象。
