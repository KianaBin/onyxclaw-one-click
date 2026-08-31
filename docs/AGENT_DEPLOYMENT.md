# Agent 自主部署 Runbook：OnyxClaw on CCE + AgentSphere

本文供自动化 Agent 读取并执行。人工操作者应从项目根目录的 [`README.md`](../README.md) 开始。
两种入口共用 `config/config.env`、`config/secrets.env`、`config/openclaw-base-config.json`，不得维护第二套 YAML。

## 目标与边界

目标是在目标用户已经准备好的华南-广州 `cn-south-1` 华为云账号、CCE 和 AgentSphere 环境中，从空白
Kubernetes namespace 部署 OnyxClaw Cloud APP，并证明 APP 能选择 AgentSphere Provider。
完全空白账号的云资源创建顺序以 [`CLOUD_PREREQUISITES.md`](./CLOUD_PREREQUISITES.md) 为准。

Agent 不负责创建或购买华为云账号、AgentSphere 服务，也不得自行扩大 IAM/RBAC、安全组或公网暴露范围。
只有用户明确授权并先审阅 Terraform plan 时，Agent 才可按 [`iac/cce`](../iac/cce/README.md) 创建独立的
VPC、CCE、NAT/SNAT 与 SFS；AgentSphere 智能体网关和 Template 仍是人工控制台边界。开启私网访问的网关、
Template、CCE 到 AgentSphere 的网络、
模型服务公网访问所需的 NAT Gateway/SNAT、DeepSeek 等模型 API Key 和必选 SFS Turbo 由目标
用户准备；缺少任一关键输入时停止写操作并准确报告缺口。

## 必需输入

执行前必须取得并验证：

- 目标用户创建 CCE 集群后，从控制台导出并在部署机本地安全保存的 kubeconfig 绝对路径；默认使用其
  current context。仅 kubeconfig 包含多个目标时才要求用户指定 context；导出操作遵循[华为云 CCE kubeconfig 指引](https://support.huaweicloud.com/usermanual-cce/cce_10_0107.html)；
- 已创建智能体网关的私网 Sandbox 数据面 URL、人工创建后的 Template ID 和 E2B API Key；
- 智能体网关已按[华为云创建智能体网关文档](https://support.huaweicloud.com/usermanual-agentsphere/agentsphere_03_0024.html)
  创建并开启私网访问，且它与 Template/Sandbox 使用同一 VPC 的确认结果；
- 由目标用户自行申请的 DeepSeek API Key；模型、固定 APP digest、公开 OpenClaw Template 镜像、
  Region、namespace、端口、Channel ELB 创建方式、SFS workspace 与 OpenClaw 基础配置均为交付包固定值；
- AgentSphere Sandbox 所在子网到公网模型 Endpoint 的 NAT Gateway/SNAT 规则，以及 HTTPS
  出网连通性验证；
- CCE 自动创建 Channel 私网 ELB 所需的网络条件；不预创建 ELB、`18890/TCP` 监听器或后端，全部交由
  CCE LoadBalancer Service 托管；
- 与 CCE/AgentSphere 同 VPC 的 SFS Turbo ID，以及 UID/GID 1000 写权限验证结果。

真实 Secret 只能进入本地 `config/secrets.env` 和 Kubernetes Secret。不得打印、回显、提交、写入
ConfigMap/Deployment 或聊天回复。不得读取现有 Secret 的 `.data`；只允许检查 Secret 名称
和键名。kubeconfig 是高敏感凭据，不得展示或提交。

## 执行协议

### 1. 仓库与本地输入预检

1. 阅读本文件、项目根目录 `README.md`、`config/config.env.example` 和当前工作区根目录的约束文件。
2. 确认工作树状态，保留用户已有修改；不要删除或覆盖无关文件。
3. 运行 `./scripts/init.sh` 准备 `config/config.env`、`config/secrets.env`、`config/openclaw-base-config.json`；脚本不会覆盖
   已有文件，并把新文件权限设为 600。
4. 不得把服务器密码、API Key 或 kubeconfig 复制进仓库。
5. 执行：

   ```bash
   node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env --dry-run
   ```

6. dry-run 失败时修复输入，不得绕过校验。

如果 SFS Turbo 尚未准备，先使用本目录唯一的 SFS 写入口：

```bash
./scripts/prepare-sfs.sh \
  --kubeconfig <absolute-path> \
  --nfs-endpoint <console-shared-path> \
  --share-path /onyxclaw/workspace
```

成功证据必须包含 `directory-owner=1000:1000` 和 `SFS_PREPARE_OK`。脚本只创建并删除固定名称的
临时 Pod；失败时保留该 Pod 供诊断，不得改写另一套持久化 Manifest。

### 2. CCE 只读预检

所有命令显式传入目标 kubeconfig；多 context 文件才额外传入 `--context`，至少确认：

```bash
kubectl --kubeconfig <path> cluster-info
kubectl --kubeconfig <path> auth can-i create deployments -n onyxclaw
kubectl --kubeconfig <path> get namespace onyxclaw
kubectl --kubeconfig <path> get deployment,service,configmap -n onyxclaw
```

若 namespace 已有同名资源，先读取其非敏感 spec 并比较。不得假设仓库快照就是集群真实状态。
发现不属于本次 OnyxClaw 部署的同名资源、无法识别的现有 ELB 绑定或目标 context 不符时，
停止并请求用户确认。

部署器要求所有可更新的同名资源带有
`app.kubernetes.io/managed-by=onyxclaw-one-click`。不得为了绕过 collision 检查而手工补标签；
历史资源迁移必须由用户单独授权并制定迁移方案。

本项目两张稳定镜像公开可拉取，默认不需要 `imagePullSecrets`。如果用户替换 APP 为私有
镜像，确认指定的 `IMAGE_PULL_SECRET` 存在；不得创建或回显仓库密码，除非用户明确把凭据
管理纳入本次任务。

运行部署器自带的只读检查，并保留非敏感结果：

```bash
./scripts/deploy.sh --check-cluster
```

执行 `./scripts/deploy.sh --server-dry-run` 时，如果配置中的 namespace 不存在，部署器会先创建这个 namespace，
再让 CCE API Server 验证其余对象且不持久化；如果 namespace 已存在，则不会持久化任何变更。不要把
server-side dry-run 当成真实部署成功证据。

### 3. 部署

用户明确要求执行部署后，运行唯一的写入口：

```bash
node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env
```

脚本按以下顺序执行：Namespace → APP Service → Channel Service → 等待 Channel ELB →
Provider ConfigMap → Secret → Deployment → rollout → Pod 内 `/api/ui-config` 验证。

不得手工创建另一套 Manifest。脚本失败后先读取事件、Pod 状态和脱敏日志；不得通过放宽安全组、
公开 Secret、使用 `--insecure-skip-tls-verify` 或改成公网 Endpoint 来规避问题。

### 4. 验收证据

部署成功至少需要保存以下非敏感证据：

- Deployment 为期望副本数且全部 Ready；
- APP Pod `imageID` 是已验证的不可变 digest；
- APP 与 Channel Service 的类型、端口和 Channel ELB 地址符合输入；
- `/api/ui-config` 返回 `deploymentMode=cloud`、
  `providerId=huaweicloud-agentsphere`、正确 Region/Template/Model；
- ConfigMap 中没有 Key/Token，Secret 只检查四个预期键名；
- APP Pod 到 AgentSphere 控制面/数据面 DNS、TCP、TLS 可达；Sandbox 经 SNAT 到公网模型
  Endpoint 的 DNS、TCP、TLS 可达；
- AgentSphere Sandbox 能回连 Channel；创建、SOUL 确认、唯一口令对话、kill 无残留均成功；
- Profile 中 pause/resume 与 memory persistence 为 true，SFS workspace 对 UID/GID 1000
  可写；pause/resume 底层能力由 AgentSphere 提供，不在部署器中重新实现。

应用 readiness 通过但未完成 Sandbox/对话/清理时，只能报告“应用部署成功，端到端验收未完成”，
不得宣称整体完成。

## 故障与停止条件

- `ImagePullBackOff`：核对 APP 镜像 digest、镜像仓库权限和 `IMAGE_PULL_SECRET`，不改成浮动标签。
- ELB 长时间无地址：核对 `kubernetes.io/elb.id` 或 `kubernetes.io/elb.autocreate`、子网和
  CCE 事件；不得把私网 Channel 擅自改为公网。
- APP 启动时报 Provider/Secret 缺失：比较 ConfigMap 字段与 Secret 键名，不读取值。
- Sandbox API 失败：保留阶段、status code、request ID 和脱敏日志，区分控制面/数据面。
- Channel 失败：从 Sandbox 视角验证私网 ELB、路由、DNS、端口和 WebSocket Upgrade。
- 需要新增云权限、修改网络边界、替换 AgentSphere Template 或影响现有业务资源时停止，向用户
  说明精确变更和风险后再继续。

不得批量删除文件或目录。清理云端测试对象时只处理本次运行创建且 ID 已明确的单个对象；
任何 namespace、ELB、SFS、CCE 节点或未知 Sandbox 的删除都需要用户明确授权。

## 权威参考

- [CCE kubectl 连接](https://support.huaweicloud.com/usermanual-cce/cce_10_0107.html)
- [CCE LoadBalancer Service annotations](https://support.huaweicloud.com/usermanual-cce/cce_10_0385.html)
- [CCE 系统 Secret 与 SWR 拉取](https://support.huaweicloud.com/usermanual-cce/cce_10_0388.html)
- [CCE 镜像免密下载](https://support.huaweicloud.com/usermanual-cce/cce_10_1091.html)
- [AgentSphere 创建模板](https://support.huaweicloud.com/usermanual-agentsphere/agentsphere_03_0006.html)
- [人工部署与使用](./HUMAN_DEPLOYMENT.md)
