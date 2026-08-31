# 云资源前置条件：华为云空账号到可部署状态

本手册定义一键部署之前由用户在华为云控制台完成的部分。它适合新账号或没有现成网络、CCE、
AgentSphere 资源的环境；完成后转到 [人工部署与使用](./HUMAN_DEPLOYMENT.md)。

目标是让 CCE APP、AgentSphere Gateway/Template/Sandbox 与 SFS Turbo 位于同一 VPC，并让 Sandbox
通过 SNAT 访问公网模型服务。推荐 Region 为 `cn-south-1`（华南-广州）。

## 创建顺序

```text
账号/权限 → VPC与子网 → CCE集群与节点 → kubeconfig
→ NAT Gateway与SNAT → SFS Turbo → AgentSphere网关
→ 复制OpenClaw镜像至本租户SWR → 创建Template → 填写本地配置 → 部署
```

| 阶段 | 需要记录的输出 | 是否由脚本完成 |
| --- | --- | --- |
| VPC/子网 | VPC、子网 ID 与 CIDR | 否 |
| CCE | kubeconfig 绝对路径、context、节点状态 | 否 |
| NAT/SNAT | Sandbox 所在子网具备公网 HTTPS 出网 | 否 |
| SFS Turbo | 文件系统 ID、NFS 共享根路径 | SFS 目录准备由脚本完成 |
| AgentSphere 网关 | 私网数据面 URL | 否 |
| SWR/Template | 目标租户镜像 `image@digest`、Template ID | 否 |
| Kubernetes APP | namespace、Service、Channel ELB、Deployment | 是 |

## 0. 账号、部署机和密钥

用户需要具备创建或使用 VPC、CCE、EIP、NAT Gateway、SFS Turbo、SWR、ELB、AgentSphere 的权限，
并承担按需资源费用。部署机需安装 Node.js `22.19+` 与 `kubectl`。

另行申请以下密钥，稍后只填写到本地 `config/secrets.env`：

- AgentSphere E2B API Key；
- DeepSeek API Key（或所选模型 Provider 的等价密钥）。

不要把云账号密码、节点登录密码、SSH 私钥、kubeconfig 或 API Key 写入本包任何可提交文件。

## 1. 创建 VPC 和子网

创建一个 VPC 和至少一个子网，供 CCE 节点、AgentSphere 智能体网关、Template/Sandbox 和 SFS Turbo 使用。
VPC CIDR 不得与 CCE 容器网段、Service 网段或部署机所在网络冲突。例如 VPC `192.168.0.0/16`，子网 `192.168.0.0/24`；最终以账号既有网络规划为准。

记录 VPC/子网的名称、ID、CIDR、安全组。默认 DNS 可以保持华为云配置，无需为本演示单独搭建 DNS。
参考：[创建 VPC 和子网](https://support.huaweicloud.com/usermanual-vpc/zh-cn_topic_0013935842.html)。

## 2. 创建 CCE 集群、节点并导出 kubeconfig

1. 在同一 Region/VPC 创建 CCE 集群，容器网段、Service 网段均不得与 VPC 网段重叠；
2. 为 API Server 绑定 EIP，供部署机远程运行 `kubectl`；
3. 绑定后重新下载公网 kubeconfig；
4. 添加至少一个工作节点，等待其为 `Ready`；
5. 在部署机验证 kubeconfig、context 与节点状态。

注意：集群 API Server EIP、节点 SSH EIP、NAT/SNAT EIP 是三种不同用途的公网入口，不能混用。节点 EIP 仅在
需要 SSH 或访问 APP NodePort 时配置；不用 SSH 时无需为部署脚本准备节点密码或密钥。Demo/Test 可使用
2 vCPU/8 GiB、Ubuntu 22.04、containerd、50 GiB 系统盘和 100 GiB 数据盘的按需节点作为起点；生产应按
可用性和容量设计节点规模。

下载 kubeconfig 后收紧权限并确认：

```bash
chmod 600 /absolute/path/to/cce-kubeconfig.yaml
kubectl --kubeconfig /absolute/path/to/cce-kubeconfig.yaml config get-contexts
kubectl --kubeconfig /absolute/path/to/cce-kubeconfig.yaml --context <target-context> get nodes -o wide
```

参考：[创建 CCE 集群](https://support.huaweicloud.com/intl/zh-cn/usermanual-cce/cce_10_0028.html)、
[创建节点](https://support.huaweicloud.com/usermanual-cce/cce_10_0363.html)、
[获取 kubeconfig](https://support.huaweicloud.com/usermanual-cce/cce_10_0107.html)、
[配置 API Server 公网访问](https://support.huaweicloud.com/usermanual-cce/cce_10_0864.html)。

## 3. 配置 Sandbox 的公网模型出网

创建公网 NAT Gateway，并在 **AgentSphere Sandbox 实际使用的子网** 上添加 SNAT 规则，绑定独立 EIP。
这条规则用于 Sandbox 中的 OpenClaw 请求 `https://api.deepseek.com` 等公网模型 Endpoint；至少应允许
DNS 与 HTTPS `443/TCP` 出网。

NAT Gateway 创建后仍需添加 SNAT 规则；只购买 NAT 或只创建 EIP 不足以让 Sandbox 出网。不要将节点入站
EIP 当作 SNAT EIP。实际的 NAT 规格、带宽与计费按账号的测试/生产容量决定。

参考：[购买公网 NAT Gateway](https://support.huaweicloud.com/usermanual-natgateway/zh-cn_topic_0150270259.html)、
[添加 SNAT 规则](https://support.huaweicloud.com/usermanual-natgateway/zh-cn_topic_0127489529.html)。

## 4. 创建 SFS Turbo 并准备 workspace

创建与 CCE/AgentSphere 同 VPC 的 SFS Turbo。Demo/Test 可选择 NFS 协议、与节点相同可用区的性能型实例；
容量和安全组由实际业务决定。记录：

- SFS Turbo 文件系统 ID，填写到 `SFS_TURBO_ID`；
- 控制台给出的 NFS 共享根路径（形如 `192.168.x.x:/`）。

SFS 创建后，使用 `scripts/prepare-sfs.sh` 初始化 `/onyxclaw/workspace` 并验证 UID/GID `1000` 写权限。
命令见 [人工部署与使用](./HUMAN_DEPLOYMENT.md#2-准备并验证-sfs-turbo)。

参考：[创建 SFS Turbo 文件系统](https://support.huaweicloud.com/usermanual-sfsturbo/sfsturbo_01_0359.html)。

## 5. 创建智能体网关

在 AgentSphere 创建智能体网关，或使用账号内系统默认网关。必须同时满足：

- 状态为可用；
- **开启私网访问**；
- 关联本次 VPC 和子网；
- 后续 Template 与 Sandbox 使用相同 VPC/子网。

记录网关的**私网数据面地址**，例如 `https://<gateway-host>`，填写到
`AGENTSPHERE_SANDBOX_URL`。

以“VPC 关联状态可用 + 私网访问开启”为继续条件。

参考：[创建智能体网关](https://support.huaweicloud.com/usermanual-agentsphere/agentsphere_03_0024.html)。

## 6. 复制稳定 OpenClaw 镜像到目标租户 SWR

当前稳定 OpenClaw 源镜像是公开镜像：

```text
swr.cn-south-1.myhuaweicloud.com/demo-test/onyxclaw-openclaw:0.3.8-channel-error-fix
sha256:d29c37290298d374dd6438ae92ee2def3dadf9e1f7599704f341483c302442b5
```

在一个可拉取镜像的 CCE 节点（containerd）或其他可用 Docker 主机上拉取，然后按目标租户 SWR 控制台生成的
登录/推送命令，推送到本租户同 Region 的组织和仓库。推送后用 digest 核对目标镜像内容与上面一致，并记录：

```text
swr.cn-south-1.myhuaweicloud.com/<target-org>/onyxclaw-openclaw:0.3.8-channel-error-fix@sha256:d29c...
```

Template 使用目标租户 SWR 的完整 `image@sha256:digest` 地址；不要只填 tag。推送凭据属于敏感信息，不写入
配置或文档。公开 APP 镜像由脚本直接使用，无需复制。

## 7. 在 AgentSphere 创建 Template

创建 Template 前先有可用的私网网关和目标租户 SWR 镜像。控制台中的关键选择为：

- 选择步骤 6 的目标租户 OpenClaw 镜像；
- 关联已开启私网访问的智能体网关；
- 选择与网关、SFS、CCE 相同的 VPC/子网；
- 健康检查使用 HTTP `/health`，端口 `49983`；
- 启用空闲超时，可用 5分钟 作为 Demo/Test 起点；
- 不在 Template 页面再次静态挂载 SFS Turbo。APP 创建 Sandbox 时会通过运行时元数据注入 SFS 挂载。

gateway与template示例：
![智能体网关配置位置](../assets/网关示例.png)

![Template 配置位置](../assets/示例模板.png)

提交后记录 Template ID，并将 `AGENTSPHERE_TEMPLATE_READY=true` 写入配置。控制台详细步骤见
[创建 AgentSphere Template](https://support.huaweicloud.com/usermanual-agentsphere/agentsphere_03_0006.html)。

## 8. 进入部署阶段

至此应已具备：kubeconfig/context、SFS ID/NFS 根路径、网关私网 URL、目标租户 Template 镜像及 ID、
AgentSphere/模型 API Key，以及 Sandbox 子网 SNAT 出网。回到 [人工部署与使用](./HUMAN_DEPLOYMENT.md)
初始化 `config/` 并开始部署。

Channel 私网 ELB 不在本阶段预建。默认配置会由 CCE 在部署时自动创建共享型私网 ELB，并托管
`18890/TCP` 监听器和后端；仅需复用企业已有 ELB 时才填写其 ID。相关机制见
[CCE LoadBalancer Service annotations](https://support.huaweicloud.com/usermanual-cce/cce_10_0385.html)。

## 费用与清理

测试结束后，在 APP 内 reset 明确的 Sandbox，再逐项检查 CCE 节点、API Server/节点/NAT EIP、
NAT Gateway、SFS Turbo 和自动创建 ELB。确认明确资源 ID 和依赖关系后，再单独决定保留或释放；
不要批量删除账号资源。
