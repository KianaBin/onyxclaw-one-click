# 空账号端到端自测记录（参考）

更新时间：2026-08-31（Asia/Shanghai）。这是一轮在全新华为云账号中完成的真实可用性验证记录，
用于解释推荐顺序、校验点和已遇到的问题；不是可复制的环境配置，也不能使用其中任何资源 ID、IP、
Template ID 或密钥替代目标用户自己的输入。

## 验证范围与结果

在华南-广州的一个新账号中，完成了以下闭环：

1. 创建 VPC/子网、CCE Standard 集群与单个工作节点，下载并使用 API Server 公网 kubeconfig；
2. 为 Sandbox 子网创建 NAT Gateway、独立 SNAT EIP 和 SNAT 规则；
3. 创建 NFS SFS Turbo，并通过 `scripts/prepare-sfs.sh` 获得
   `directory-owner=1000:1000` 与 `SFS_PREPARE_OK`；
4. 启用并关联 AgentSphere 私网智能体网关，在 Template 的“选择镜像”直接填写公开 OpenClaw tag，创建 Template；
5. 使用本包的 `--dry-run`、`--check-cluster`、`--server-dry-run` 与正式部署完成新 namespace 首次发布；
6. 创建两个测试 Sandbox；其中一个完整验证模型对话、pause/resume、SFS 人格持久化与 reset，另一个
   验证 create/pause/resume/reset；最终 APP 回到 idle。

结论：当前稳定 APP v19 与 OpenClaw `0.3.8-channel-error-fix` 的组合，在上述新账号拓扑中完成了
创建、对话、持久化、pause/resume 和 reset 的端到端验证。

## 实测采用的拓扑选择

| 项目 | 实测选择 | 可复用的结论 |
| --- | --- | --- |
| 网络 | 单个 VPC 与 `/24` 初始子网 | CCE、网关、Template/Sandbox、SFS 选择同一 VPC/子网。 |
| CCE | Standard、v1.33、单工作节点、VPC 网络模型 | 单节点可完成 Demo/Test；系统组件的反亲和 Pending 不等同于应用故障。 |
| 节点 | 2 vCPU/8 GiB、Ubuntu 22.04、containerd | 可支撑本演示的基础验证；生产需要单独做容量与 HA 设计。 |
| 出网 | 公网 NAT Gateway + Sandbox 子网 SNAT | 模型对话依赖这条出网路径，节点 EIP 不能代替它。 |
| 存储 | NFS SFS Turbo，workspace `/onyxclaw/workspace` | 必须提前确认 UID/GID 1000 可写。 |
| Channel | CCE `elb.autocreate` 生成私网共享 ELB | 不需要预建 ELB、TCP 监听器或手工后端。 |
| APP 页面 | NodePort `30080` | 可以用节点 EIP 临时访问，也可用 port-forward 降低公网暴露。 |

## 部署器实测证据

- `--server-dry-run` 在目标 namespace 不存在时按配置创建 namespace，其余资源只做 CCE API Server
  校验；正式部署后 APP Deployment `1/1 Ready`；
- CCE 自动创建 Channel 私网 ELB，端口为 `18890/TCP`，TCP 回连通过；
- APP Pod 内同时成功解析 AgentSphere **控制面**和智能体网关**私网数据面**域名，并能解析模型 Endpoint；
- `/api/ui-config` 返回 `deploymentMode=cloud` 和
  `providerId=huaweicloud-agentsphere`；
- Template 中填写的 OpenClaw 公开 tag 与稳定基线一致；
- 重复运行正式部署成功，验证脚本具备预期幂等性。

## 功能验收证据

主测试 Sandbox 的完整轨迹为：

```text
Sandbox.create 成功
→ 写入 openclaw.json
→ 写入 SFS 中的 SOUL.md
→ Gateway ready
→ Channel connected
→ DeepSeek 对话成功
→ pause 成功
→ 用同一 Sandbox ID resume 成功
→ 读取到原 SOUL.md，得到新 connection ID，再次对话成功
→ reset 成功，APP mode=idle / sandboxId=null / error=null
```

pause/resume 恢复期间首次 readiness 检查曾短暂失败；重试后成功，最终没有 error。这表明验收应关注
最终恢复状态，而不应把一次短暂就绪延迟直接判为失败。

## 已踩到且已修正的问题

| 现象 | 原因 | 固化到交付物的处理 |
| --- | --- | --- |
| 创建 Sandbox 报 `Name or service not known` | `AGENTSPHERE_API_URL` 错填成不存在的 `sandbox-service...` 域名 | 配置示例和文档固定说明华南-广州控制面应为 `https://agentsphere.cn-south-1.myhuaweicloud.com`；部署后从 APP Pod 校验两个 AgentSphere DNS。 |
| 新建网关显示 VPC/子网关联异常 | 初始网关关联没有成功 | 系统默认网关在目标 VPC/子网中显示可用且私网访问已开启时可使用；关键是最终关联状态，而非网关名称。 |
| 不清楚 ELB 是否提前创建 | 把 CCE 托管 Service 与手工 ELB 后端流程混在一起 | 默认完全交给 `kubernetes.io/elb.autocreate`；手工 ELB 仅是复用现有 ELB 的特殊模式。 |
| 初次 server dry-run 无 namespace | Kubernetes API 对 namespaced 对象进行 dry-run 前需要 namespace 存在 | 部署器将配置的缺失 namespace 作为唯一持久化对象创建；其他资源仍不保存。 |

## 使用这份记录的方式

将它作为问题定位和验收对照：比较资源创建顺序、网关私网访问、SFS 写权限、控制面 URL、Channel ELB
托管行为和端到端状态机。不要照抄任何具体的云资源名称、ID、IP、子网 CIDR、EIP、Template ID 或测试
Sandbox ID；目标环境必须在 `config/` 中填写自己的值。
