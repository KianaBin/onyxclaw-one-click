# 已验证稳定基线（对照用）

更新时间：2026-08-29（Asia/Shanghai）。本页根据参考环境的只读检查和仓库记录整理，用于在目标用户完成
部署后对照镜像 digest、Service/ELB、AgentSphere Profile、SFS Turbo、网络与生命周期关键项。这里的
集群、namespace、Template ID、ELB VIP 等均为参考环境值，绝不是新部署的配置输入。

## 应用与用途

OnyxClaw Cloud APP 在浏览器中呈现模拟手机 APP，后端通过 E2B-compatible SDK 管理
AgentSphere Sandbox。用户流程包括创建 Sandbox、确认 `SOUL.md`、等待 OpenClaw Gateway
与 Channel 就绪、发起模型对话、暂停/恢复以及最终 kill/reset。

## 稳定镜像

| 组件 | 稳定 tag | 已知 digest | 证据 |
| --- | --- | --- | --- |
| Cloud APP | `swr.cn-south-1.myhuaweicloud.com/demo-test/onyxclaw-app:0.3.8-session-routing-debug-nodelay-wait5s-v19` | `sha256:fe0c5274fff79897fce53634756694edc9799f393e3e3dde416d604749788293` | 当前 Ready Pod 的 `imageID` |
| AgentSphere OpenClaw | `swr.cn-south-1.myhuaweicloud.com/demo-test/onyxclaw-openclaw:0.3.8-channel-error-fix` | `sha256:d29c37290298d374dd6438ae92ee2def3dadf9e1f7599704f341483c302442b5` | 用户确认当前 Template 由该稳定镜像创建；digest 来自仓库构建记录 |

两张源镜像均为公开镜像，可以直接拉取。CCE APP 可直接固定使用公开源镜像；AgentSphere Template
若要求本租户 SWR 镜像，必须先把 OpenClaw 镜像复制到目标租户的同 Region SWR。复制后的仓库地址会
改变，但 digest 应仍为上表的 `sha256:d29c...42b5`。目标部署使用 `image@sha256:...`，不得仅凭 tag
名称推断内容一致。

## CCE 只读盘点

- Region：`cn-south-1`
- 集群：`testdemo`
- Namespace：`onyxclaw-demo`
- Deployment：`onyxclaw-app`，`1/1` Ready
- APP 暴露：`onyxclaw-app` NodePort，`3000:30080/TCP`
- Channel 集群内入口：`onyxclaw-channel` ClusterIP，`18890/TCP`
- Channel 私网入口：一个绑定已有 ELB 的 LoadBalancer Service，VIP
  `192.168.2.13:18890`
- APP 当前模式：`idle`，无运行中的 Sandbox

当前 APP Service 可通过 CCE 节点公网 EIP 的 `30080` 端口访问。公网 EIP、NodePort 安全组
和来源 CIDR 属于目标用户环境配置，不应硬编码到通用部署器。

## 当前 AgentSphere Profile

- Provider ID：`huaweicloud-agentsphere`
- Region：`cn-south-1`
- 控制面：`https://agentsphere.cn-south-1.myhuaweicloud.com`
- Sandbox 数据面：独立的 Agent Gateway URL
- Template ID：`14e7349e-b1f0-4645-8e72-19eae59af5d0`
- Channel URL：`ws://192.168.2.13:18890/connect`
- 模型：`deepseek/deepseek-v4-flash`
- 生命周期：`onTimeout=pause`、`cleanupPolicy=kill`
- 能力：pause/resume、SFS memory persistence、VPC 网络

Secret `onyxclaw-app-runtime` 只确认包含以下键名，未读取或记录值：

- `agentsphere-e2b-api-key`
- `model-api-key`
- `channel-signing-secret`
- `openclaw-base-config-json`

## 已确认的交付约束

1. 当前 Template `14e7349e-b1f0-4645-8e72-19eae59af5d0` 由上述
   `0.3.8-channel-error-fix` 镜像创建；
2. AgentSphere Template 由目标用户按华为云控制台文档人工创建，一键脚本消费 Template ID；
3. 默认沿用 APP NodePort + Channel 私网 ELB；CCE APP、AgentSphere Sandbox 与 SFS Turbo
   位于同一 VPC；
4. SFS Turbo 和 memory persistence 为必选；pause/resume 使用 AgentSphere 自身能力；
5. 两张稳定 SWR 镜像均公开可拉取。
