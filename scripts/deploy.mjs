#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROVIDER_ID = "huaweicloud-agentsphere";
const APP_NAME = "onyxclaw-app";
const DEFAULT_CHANNEL_SERVICE_NAME = "onyxclaw-channel-lb";
const SECRET_NAME = "onyxclaw-app-runtime";
const CONFIG_NAME = "onyxclaw-provider-config";
const MANAGED_BY = "onyxclaw-one-click";

function resourceLabels(extra = {}) {
  return {
    "app.kubernetes.io/part-of": "onyxclaw",
    "app.kubernetes.io/managed-by": MANAGED_BY,
    ...extra,
  };
}

function parseEnvText(text, label = "env file") {
  const result = {};
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) throw new Error(`${label}:${index + 1}: expected KEY=VALUE`);
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function required(values, name) {
  const value = values[name]?.trim();
  if (!value || /^<.*>$/.test(value) || value.includes("<digest>")) {
    throw new Error(`${name} is required and must not contain an example placeholder`);
  }
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function booleanValue(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function urlValue(value, name, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function parseJsonObject(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(value || "{}");
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== "string") throw new Error(`${name}.${key} must be a string`);
  }
  return parsed;
}

function validateBaseConfig(baseConfig, config) {
  const serialized = JSON.stringify(baseConfig);
  if (!serialized.includes("__ONYXCLAW_MODEL_API_KEY__")) {
    throw new Error("OpenClaw base config must contain __ONYXCLAW_MODEL_API_KEY__");
  }
  if (!serialized.includes("__ONYXCLAW_GATEWAY_TOKEN__")) {
    throw new Error("OpenClaw base config must contain __ONYXCLAW_GATEWAY_TOKEN__");
  }
  const primary = baseConfig?.agents?.defaults?.model?.primary;
  const expected = `${config.MODEL_PROVIDER}/${config.MODEL_ID}`;
  if (primary !== expected) {
    throw new Error(`OpenClaw primary model must be ${expected}, found ${primary || "missing"}`);
  }
  if (!baseConfig?.models?.providers?.[config.MODEL_PROVIDER]) {
    throw new Error(`OpenClaw base config is missing provider ${config.MODEL_PROVIDER}`);
  }
}

function normalizedConfig(raw) {
  const appServiceType = raw.APP_SERVICE_TYPE || "NodePort";
  const channelServiceType = raw.CHANNEL_SERVICE_TYPE || "LoadBalancer";
  for (const [name, value] of [
    ["APP_SERVICE_TYPE", appServiceType],
    ["CHANNEL_SERVICE_TYPE", channelServiceType],
  ]) {
    if (!["LoadBalancer", "NodePort", "ClusterIP"].includes(value)) {
      throw new Error(`${name} must be LoadBalancer, NodePort, or ClusterIP`);
    }
  }
  const sandboxOnTimeout = raw.SANDBOX_ON_TIMEOUT || "pause";
  const cleanupPolicy = raw.CLEANUP_POLICY || "kill";
  if (!["pause", "kill"].includes(sandboxOnTimeout)) {
    throw new Error("SANDBOX_ON_TIMEOUT must be pause or kill");
  }
  if (!["pause", "kill", "keep-running"].includes(cleanupPolicy)) {
    throw new Error("CLEANUP_POLICY must be pause, kill, or keep-running");
  }

  const config = {
    ...raw,
    KUBE_CONTEXT: required(raw, "KUBE_CONTEXT"),
    KUBECONFIG: required(raw, "KUBECONFIG"),
    NAMESPACE: required(raw, "NAMESPACE"),
    REGION: required(raw, "REGION"),
    APP_IMAGE: required(raw, "APP_IMAGE"),
    REPLICAS: positiveInteger(raw.REPLICAS || "1", "REPLICAS"),
    AGENTSPHERE_API_URL: urlValue(
      required(raw, "AGENTSPHERE_API_URL"),
      "AGENTSPHERE_API_URL",
      ["https:", "http:"],
    ),
    AGENTSPHERE_SANDBOX_URL: urlValue(
      required(raw, "AGENTSPHERE_SANDBOX_URL"),
      "AGENTSPHERE_SANDBOX_URL",
      ["https:", "http:"],
    ),
    AGENTSPHERE_TEMPLATE_ID: required(raw, "AGENTSPHERE_TEMPLATE_ID"),
    AGENTSPHERE_TEMPLATE_IMAGE: required(raw, "AGENTSPHERE_TEMPLATE_IMAGE"),
    AGENTSPHERE_TEMPLATE_READY: booleanValue(
      raw.AGENTSPHERE_TEMPLATE_READY || "false",
      "AGENTSPHERE_TEMPLATE_READY",
    ),
    APP_SERVICE_TYPE: appServiceType,
    APP_SERVICE_ANNOTATIONS: parseJsonObject(
      raw.APP_SERVICE_ANNOTATIONS_JSON || "{}",
      "APP_SERVICE_ANNOTATIONS_JSON",
    ),
    APP_NODE_PORT: raw.APP_NODE_PORT
      ? positiveInteger(raw.APP_NODE_PORT, "APP_NODE_PORT")
      : null,
    APP_PUBLIC_URL: raw.APP_PUBLIC_URL || "",
    CHANNEL_SERVICE_TYPE: channelServiceType,
    CHANNEL_SERVICE_NAME: raw.CHANNEL_SERVICE_NAME || DEFAULT_CHANNEL_SERVICE_NAME,
    CHANNEL_SERVICE_ANNOTATIONS: parseJsonObject(
      raw.CHANNEL_SERVICE_ANNOTATIONS_JSON || "{}",
      "CHANNEL_SERVICE_ANNOTATIONS_JSON",
    ),
    APP_SERVICE_PORT: positiveInteger(raw.APP_SERVICE_PORT || "3000", "APP_SERVICE_PORT"),
    CHANNEL_SERVICE_PORT: positiveInteger(
      raw.CHANNEL_SERVICE_PORT || "18890",
      "CHANNEL_SERVICE_PORT",
    ),
    CHANNEL_PUBLIC_URL: raw.CHANNEL_PUBLIC_URL || "auto",
    MODEL_PROVIDER: required(raw, "MODEL_PROVIDER"),
    MODEL_ID: required(raw, "MODEL_ID"),
    SANDBOX_ON_TIMEOUT: sandboxOnTimeout,
    CLEANUP_POLICY: cleanupPolicy,
    PAUSE_RESUME: booleanValue(raw.PAUSE_RESUME || "false", "PAUSE_RESUME"),
    MEMORY_PERSISTENCE: booleanValue(
      raw.MEMORY_PERSISTENCE || "false",
      "MEMORY_PERSISTENCE",
    ),
    SFS_TURBO_ID: required(raw, "SFS_TURBO_ID"),
    SFS_SHARE_PATH: required(raw, "SFS_SHARE_PATH"),
    SFS_MOUNT_DIR: raw.SFS_MOUNT_DIR || "/home/node/.openclaw/workspace",
    CPU_REQUEST: raw.CPU_REQUEST || "100m",
    MEMORY_REQUEST: raw.MEMORY_REQUEST || "128Mi",
    CPU_LIMIT: raw.CPU_LIMIT || "1",
    MEMORY_LIMIT: raw.MEMORY_LIMIT || "1Gi",
  };

  if (!/@sha256:[0-9a-f]{64}$/i.test(config.APP_IMAGE)) {
    throw new Error("APP_IMAGE must be an immutable image@sha256:<64-hex-digest> reference");
  }
  if (!/@sha256:[0-9a-f]{64}$/i.test(config.AGENTSPHERE_TEMPLATE_IMAGE)) {
    throw new Error(
      "AGENTSPHERE_TEMPLATE_IMAGE must be an immutable image@sha256:<64-hex-digest> reference",
    );
  }
  if (!config.AGENTSPHERE_TEMPLATE_READY) {
    throw new Error(
      "AGENTSPHERE_TEMPLATE_READY must be true after the Template is created manually",
    );
  }
  if (!path.isAbsolute(config.KUBECONFIG)) {
    throw new Error("KUBECONFIG must be an absolute path");
  }

  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(config.NAMESPACE)) {
    throw new Error("NAMESPACE must be a valid Kubernetes namespace name");
  }
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(config.CHANNEL_SERVICE_NAME)) {
    throw new Error("CHANNEL_SERVICE_NAME must be a valid Kubernetes resource name");
  }
  if (config.CHANNEL_PUBLIC_URL !== "auto") {
    config.CHANNEL_PUBLIC_URL = urlValue(
      config.CHANNEL_PUBLIC_URL,
      "CHANNEL_PUBLIC_URL",
      ["wss:", "ws:"],
    );
  } else if (config.CHANNEL_SERVICE_TYPE !== "LoadBalancer") {
    throw new Error("CHANNEL_PUBLIC_URL=auto requires CHANNEL_SERVICE_TYPE=LoadBalancer");
  }
  if (config.APP_PUBLIC_URL) {
    config.APP_PUBLIC_URL = urlValue(
      config.APP_PUBLIC_URL,
      "APP_PUBLIC_URL",
      ["https:", "http:"],
    );
  }
  if (
    config.CHANNEL_SERVICE_TYPE === "LoadBalancer" &&
    !config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.id"] &&
    !config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"]
  ) {
    throw new Error(
      "CHANNEL_SERVICE_ANNOTATIONS_JSON must configure kubernetes.io/elb.id or kubernetes.io/elb.autocreate",
    );
  }
  if (
    config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.id"] &&
    config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"]
  ) {
    throw new Error(
      "CHANNEL_SERVICE_ANNOTATIONS_JSON must not configure both kubernetes.io/elb.id and kubernetes.io/elb.autocreate",
    );
  }
  if (config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"]) {
    parseJsonObject(
      config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"],
      "CHANNEL_SERVICE_ANNOTATIONS_JSON.kubernetes.io/elb.autocreate",
    );
  }
  for (const [key, value] of Object.entries(config.CHANNEL_SERVICE_ANNOTATIONS)) {
    if (/^<.*>$/.test(value) || value.includes("<private-elb-id>")) {
      throw new Error(`CHANNEL_SERVICE_ANNOTATIONS_JSON.${key} contains an example placeholder`);
    }
  }
  if (!config.PAUSE_RESUME) {
    throw new Error("PAUSE_RESUME must be true for the AgentSphere deployment profile");
  }
  if (!config.MEMORY_PERSISTENCE) {
    throw new Error("MEMORY_PERSISTENCE must be true because SFS Turbo is required");
  }
  if (config.SANDBOX_ON_TIMEOUT !== "pause") {
    throw new Error("SANDBOX_ON_TIMEOUT must be pause for the AgentSphere deployment profile");
  }
  return config;
}

function providerConfig(config, channelPublicUrl) {
  const metadata = {
    "agentsandbox.storage.sfs": JSON.stringify({
      sfsTurboMounts: [
        {
          sfsTurboId: config.SFS_TURBO_ID,
          sharePath: config.SFS_SHARE_PATH,
          readOnly: false,
          mountDir: config.SFS_MOUNT_DIR,
        },
      ],
    }),
  };
  return {
    schemaVersion: 1,
    defaultProvider: PROVIDER_ID,
    providers: {
      [PROVIDER_ID]: {
        displayName: "Huawei Cloud AgentSphere Sandbox",
        protocol: "e2b-compatible",
        api: {
          baseUrl: config.AGENTSPHERE_API_URL,
          sandboxUrl: config.AGENTSPHERE_SANDBOX_URL,
          privateNetworkOnly: true,
          apiKeyEnv: "HUAWEICLOUD_AGENTSPHERE_E2B_API_KEY",
          compatibilityVersion: "agentsphere-e2b-poc",
          sdkPatch: "none",
          requestTimeoutMs: 60000,
        },
        sandbox: {
          templateId: config.AGENTSPHERE_TEMPLATE_ID,
          timeoutMs: 600000,
          onTimeout: config.SANDBOX_ON_TIMEOUT,
          secure: true,
          defaultUser: "node",
          homeDir: "/home/node",
          workspaceDir: config.SFS_MOUNT_DIR,
          metadata,
        },
        openclaw: {
          binary: "node /app/openclaw.mjs",
          gatewayPort: 18789,
          installMode: "preinstalled",
          pluginInstallMode: "preinstalled",
        },
        channel: {
          publicUrl: channelPublicUrl,
          privateNetworkOnly: channelPublicUrl.startsWith("ws://"),
          connectTimeoutMs: 120000,
          signingSecretEnv: "HUAWEICLOUD_AGENTSPHERE_CHANNEL_SIGNING_SECRET",
        },
        model: {
          provider: config.MODEL_PROVIDER,
          model: config.MODEL_ID,
          apiKeyEnv: "HUAWEICLOUD_AGENTSPHERE_MODEL_API_KEY",
        },
        cleanupPolicy: config.CLEANUP_POLICY,
        capabilities: {
          pauseResume: config.PAUSE_RESUME,
          memoryPersistence: config.MEMORY_PERSISTENCE,
          publicEgress: false,
          vpc: true,
        },
      },
    },
  };
}

function appServiceResource(config) {
  const port = {
    name: "http",
    port: config.APP_SERVICE_PORT,
    targetPort: "http",
    protocol: "TCP",
  };
  if (config.APP_SERVICE_TYPE === "NodePort" && config.APP_NODE_PORT) {
    port.nodePort = config.APP_NODE_PORT;
  }
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: APP_NAME,
      namespace: config.NAMESPACE,
      labels: resourceLabels({ "app.kubernetes.io/name": APP_NAME }),
      ...(Object.keys(config.APP_SERVICE_ANNOTATIONS).length > 0
        ? { annotations: config.APP_SERVICE_ANNOTATIONS }
        : {}),
    },
    spec: {
      type: config.APP_SERVICE_TYPE,
      selector: { app: APP_NAME },
      ports: [port],
    },
  };
}

function channelServiceResource(config) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: config.CHANNEL_SERVICE_NAME,
      namespace: config.NAMESPACE,
      labels: resourceLabels({ "app.kubernetes.io/name": APP_NAME }),
      ...(Object.keys(config.CHANNEL_SERVICE_ANNOTATIONS).length > 0
        ? { annotations: config.CHANNEL_SERVICE_ANNOTATIONS }
        : {}),
    },
    spec: {
      type: config.CHANNEL_SERVICE_TYPE,
      selector: { app: APP_NAME },
      ports: [
        {
          name: "channel",
          port: config.CHANNEL_SERVICE_PORT,
          targetPort: "channel",
          protocol: "TCP",
        },
      ],
    },
  };
}

function deploymentResource(config, configChecksum) {
  const podSpec = {
    automountServiceAccountToken: false,
    containers: [
      {
        name: "app",
        image: config.APP_IMAGE,
        imagePullPolicy: "IfNotPresent",
        ports: [
          { name: "http", containerPort: 3000 },
          { name: "channel", containerPort: 18890 },
        ],
        env: [
          { name: "ONYXCLAW_PROVIDER_CONFIG", value: "/app/config/providers.agentsphere.json" },
          { name: "ONYXCLAW_PROVIDER", value: PROVIDER_ID },
          { name: "ONYXCLAW_CLOUD_REGION", value: config.REGION },
          { name: "ONYXCLAW_E2B_SANDBOX_URL", value: config.AGENTSPHERE_SANDBOX_URL },
          {
            name: "HUAWEICLOUD_AGENTSPHERE_E2B_API_KEY",
            valueFrom: { secretKeyRef: { name: SECRET_NAME, key: "agentsphere-e2b-api-key" } },
          },
          {
            name: "HUAWEICLOUD_AGENTSPHERE_MODEL_API_KEY",
            valueFrom: { secretKeyRef: { name: SECRET_NAME, key: "model-api-key" } },
          },
          {
            name: "HUAWEICLOUD_AGENTSPHERE_CHANNEL_SIGNING_SECRET",
            valueFrom: { secretKeyRef: { name: SECRET_NAME, key: "channel-signing-secret" } },
          },
          {
            name: "ONYXCLAW_OPENCLAW_BASE_CONFIG_JSON",
            valueFrom: { secretKeyRef: { name: SECRET_NAME, key: "openclaw-base-config-json" } },
          },
        ],
        volumeMounts: [
          {
            name: "provider-config",
            mountPath: "/app/config/providers.agentsphere.json",
            subPath: "providers.agentsphere.json",
            readOnly: true,
          },
        ],
        readinessProbe: {
          httpGet: { path: "/api/status", port: "http" },
          initialDelaySeconds: 3,
          periodSeconds: 5,
        },
        livenessProbe: {
          httpGet: { path: "/api/status", port: "http" },
          initialDelaySeconds: 15,
          periodSeconds: 10,
        },
        resources: {
          requests: { cpu: config.CPU_REQUEST, memory: config.MEMORY_REQUEST },
          limits: { cpu: config.CPU_LIMIT, memory: config.MEMORY_LIMIT },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          runAsNonRoot: true,
          runAsUser: 1000,
          capabilities: { drop: ["ALL"] },
        },
      },
    ],
    volumes: [{ name: "provider-config", configMap: { name: CONFIG_NAME } }],
  };
  if (config.IMAGE_PULL_SECRET) {
    podSpec.imagePullSecrets = [{ name: config.IMAGE_PULL_SECRET }];
  }
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: APP_NAME,
      namespace: config.NAMESPACE,
      labels: resourceLabels({ "app.kubernetes.io/name": APP_NAME }),
      annotations: {
        "onyxclaw.io/agentsphere-template-id": config.AGENTSPHERE_TEMPLATE_ID,
        "onyxclaw.io/agentsphere-template-image": config.AGENTSPHERE_TEMPLATE_IMAGE,
      },
    },
    spec: {
      replicas: config.REPLICAS,
      selector: { matchLabels: { app: APP_NAME } },
      template: {
        metadata: {
          labels: resourceLabels({ app: APP_NAME, "app.kubernetes.io/name": APP_NAME }),
          annotations: { "onyxclaw.io/runtime-config-checksum": configChecksum },
        },
        spec: podSpec,
      },
    },
  };
}

function buildResources({ config, secrets, baseConfig, channelPublicUrl }) {
  const provider = providerConfig(config, channelPublicUrl);
  const runtimeConfig = structuredClone(baseConfig);
  const serializedBaseConfig = JSON.stringify(runtimeConfig).replace(
    "__ONYXCLAW_GATEWAY_TOKEN__",
    secrets.OPENCLAW_GATEWAY_TOKEN,
  );
  const providerText = JSON.stringify(provider, null, 2);
  const secretData = {
    "agentsphere-e2b-api-key": secrets.AGENTSPHERE_E2B_API_KEY,
    "model-api-key": secrets.MODEL_API_KEY,
    "channel-signing-secret": secrets.CHANNEL_SIGNING_SECRET,
    "openclaw-base-config-json": serializedBaseConfig,
  };
  const configChecksum = createHash("sha256")
    .update(providerText)
    .update("\0")
    .update(JSON.stringify(secretData))
    .digest("hex");
  return {
    namespace: {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: config.NAMESPACE,
        labels: resourceLabels(),
      },
    },
    appService: appServiceResource(config),
    channelService: channelServiceResource(config),
    configMap: {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: CONFIG_NAME,
        namespace: config.NAMESPACE,
        labels: resourceLabels({ "app.kubernetes.io/name": APP_NAME }),
      },
      data: { "providers.agentsphere.json": providerText },
    },
    secret: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: SECRET_NAME,
        namespace: config.NAMESPACE,
        labels: resourceLabels({ "app.kubernetes.io/name": APP_NAME }),
      },
      type: "Opaque",
      stringData: secretData,
    },
    deployment: deploymentResource(config, configChecksum),
  };
}

function kubectlArgs(config, args) {
  return [
    ...(config.KUBECONFIG ? ["--kubeconfig", config.KUBECONFIG] : []),
    ...(config.KUBE_CONTEXT ? ["--context", config.KUBE_CONTEXT] : []),
    ...args,
  ];
}

function runKubectl(config, args, { input, capture = false } = {}) {
  const result = invokeKubectl(config, args, { input, capture });
  if (result.status !== 0) {
    const detail = capture ? `: ${(result.stderr || result.stdout).trim()}` : "";
    throw new Error(`kubectl ${args[0]} failed${detail}`);
  }
  return capture ? result.stdout : "";
}

function invokeKubectl(config, args, { input, capture = false } = {}) {
  const result = spawnSync("kubectl", kubectlArgs(config, args), {
    input,
    encoding: "utf8",
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw new Error(`failed to run kubectl: ${result.error.message}`);
  return result;
}

function applyResource(config, resource, { serverDryRun = false } = {}) {
  runKubectl(
    config,
    ["apply", ...(serverDryRun ? ["--dry-run=server"] : []), "-f", "-"],
    { input: JSON.stringify(resource) },
  );
}

function serverDryRunPlan(resources, namespaceExists) {
  const namespacedResources = [
    resources.appService,
    resources.channelService,
    resources.configMap,
    resources.secret,
    resources.deployment,
  ];
  return {
    namespaceToCreate: namespaceExists ? null : resources.namespace,
    resourcesToValidate: namespaceExists
      ? [resources.namespace, ...namespacedResources]
      : namespacedResources,
  };
}

function runtimeDnsHosts(config) {
  return [...new Set([
    new URL(config.AGENTSPHERE_API_URL).hostname,
    new URL(config.AGENTSPHERE_SANDBOX_URL).hostname,
  ])];
}

function validateRuntimeDns(config) {
  const hosts = runtimeDnsHosts(config);
  const script = [
    "const dns=require('dns').promises",
    `const hosts=${JSON.stringify(hosts)}`,
    "Promise.all(hosts.map(async host=>{const addresses=await dns.lookup(host,{all:true});console.log('DNS_OK',host,addresses.map(item=>item.address).join(','))})).catch(error=>{console.error('DNS_ERROR',error.hostname||'unknown',error.code||'',error.message);process.exit(1)})",
  ].join("; ");
  const output = runKubectl(
    config,
    ["-n", config.NAMESPACE, "exec", `deployment/${APP_NAME}`, "--", "node", "-e", script],
    { capture: true },
  ).trim();
  if (output) console.log(output);
}

async function waitForLoadBalancer(config, timeoutSeconds = 600) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const raw = runKubectl(
      config,
      ["-n", config.NAMESPACE, "get", "service", config.CHANNEL_SERVICE_NAME, "-o", "json"],
      { capture: true },
    );
    const ingress = JSON.parse(raw)?.status?.loadBalancer?.ingress?.[0];
    const address = ingress?.hostname || ingress?.ip;
    if (address) return address;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    `CCE LoadBalancer did not receive an address within ${timeoutSeconds}s; ` +
      `inspect service/${config.CHANNEL_SERVICE_NAME}`,
  );
}

function assertCanI(config, verb, resource, namespaced = true) {
  const args = [
    "auth",
    "can-i",
    verb,
    resource,
    ...(namespaced ? ["-n", config.NAMESPACE] : []),
  ];
  const result = invokeKubectl(config, args, { capture: true });
  if (result.status !== 0 || result.stdout.trim() !== "yes") {
    throw new Error(
      `current CCE identity cannot ${verb} ${resource}` +
        (namespaced ? ` in namespace ${config.NAMESPACE}` : ""),
    );
  }
}

function assertNoForeignResourceCollisions(config) {
  const targets = [
    ["service", APP_NAME],
    ["service", config.CHANNEL_SERVICE_NAME],
    ["configmap", CONFIG_NAME],
    ["secret", SECRET_NAME],
    ["deployment", APP_NAME],
  ];
  for (const [kind, name] of targets) {
    const result = invokeKubectl(
      config,
      ["-n", config.NAMESPACE, "get", kind, name, "-o", "json"],
      { capture: true },
    );
    if (result.status !== 0) {
      if (/not found/i.test(result.stderr)) continue;
      throw new Error(`failed to inspect existing ${kind}/${name}: ${result.stderr.trim()}`);
    }
    const resource = JSON.parse(result.stdout);
    const managedBy = resource?.metadata?.labels?.["app.kubernetes.io/managed-by"];
    if (managedBy !== MANAGED_BY) {
      throw new Error(
        `refusing to overwrite existing ${kind}/${name}; expected ` +
          `app.kubernetes.io/managed-by=${MANAGED_BY}`,
      );
    }
  }
}

function clusterPreflight(config, { checkOwnership = true } = {}) {
  runKubectl(config, ["version", "--client=true"]);
  const context = runKubectl(
    config,
    ["config", "get-contexts", config.KUBE_CONTEXT, "-o", "name"],
    { capture: true },
  ).trim();
  if (context !== config.KUBE_CONTEXT) {
    throw new Error(`kubeconfig does not contain context ${config.KUBE_CONTEXT}`);
  }
  runKubectl(config, ["cluster-info"]);

  assertCanI(config, "get", "namespaces", false);
  const namespaceResult = invokeKubectl(
    config,
    ["get", "namespace", config.NAMESPACE, "-o", "name"],
    { capture: true },
  );
  const namespaceExists = namespaceResult.status === 0;
  if (!namespaceExists) assertCanI(config, "create", "namespaces", false);
  for (const resource of ["services", "configmaps", "secrets", "deployments.apps"]) {
    assertCanI(config, "create", resource);
    assertCanI(config, "patch", resource);
    assertCanI(config, "get", resource);
  }
  assertCanI(config, "get", "pods");
  assertCanI(config, "list", "pods");
  assertCanI(config, "create", "pods/exec");
  if (namespaceExists && checkOwnership) assertNoForeignResourceCollisions(config);
  console.log(
    `Cluster preflight passed: namespace ${config.NAMESPACE} ` +
      (namespaceExists ? "exists" : "will be created"),
  );
  return { namespaceExists };
}

function validateUiConfig(actual, config) {
  const expected = {
    deploymentMode: "cloud",
    providerId: PROVIDER_ID,
    region: config.REGION,
    templateId: config.AGENTSPHERE_TEMPLATE_ID,
    modelProvider: config.MODEL_PROVIDER,
    modelName: config.MODEL_ID,
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => actual?.[key] !== value)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  if (mismatches.length > 0) {
    throw new Error(`deployed APP identity mismatch; expected ${mismatches.join(", ")}`);
  }
  return actual;
}

async function waitForPullSecret(config, timeoutSeconds = 60) {
  if (!config.IMAGE_PULL_SECRET) return;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = invokeKubectl(
      config,
      [
        "-n",
        config.NAMESPACE,
        "get",
        "secret",
        config.IMAGE_PULL_SECRET,
        "-o",
        "name",
      ],
      { capture: true },
    );
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `image pull Secret ${config.IMAGE_PULL_SECRET} did not appear in namespace ${config.NAMESPACE}`,
  );
}

function usage() {
  return `Usage: node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env [--dry-run|--check-cluster|--server-dry-run]\n\n` +
    "--dry-run validates inputs and prints only non-secret resource summaries.\n" +
    "--check-cluster runs read-only CCE connectivity, RBAC, and ownership checks.\n" +
    "--server-dry-run creates NAMESPACE when missing, then asks the CCE API Server to validate all other resources without persisting them.";
}

function parseArgs(argv) {
  const result = { dryRun: false, checkCluster: false, serverDryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--check-cluster") result.checkCluster = true;
    else if (arg === "--server-dry-run") result.serverDryRun = true;
    else if (arg === "--config") result.configPath = argv[++index];
    else if (arg === "--secrets") result.secretsPath = argv[++index];
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  const selectedModes = [result.dryRun, result.checkCluster, result.serverDryRun]
    .filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error("--dry-run, --check-cluster, and --server-dry-run are mutually exclusive");
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.configPath || !args.secretsPath) throw new Error(usage());

  const rawConfig = parseEnvText(await readFile(args.configPath, "utf8"), args.configPath);
  const secrets = parseEnvText(await readFile(args.secretsPath, "utf8"), args.secretsPath);
  const config = normalizedConfig(rawConfig);
  required(secrets, "AGENTSPHERE_E2B_API_KEY");
  required(secrets, "MODEL_API_KEY");
  required(secrets, "CHANNEL_SIGNING_SECRET");
  required(secrets, "OPENCLAW_GATEWAY_TOKEN");

  const baseConfigPath = path.resolve(
    path.dirname(path.resolve(args.configPath)),
    required(rawConfig, "OPENCLAW_BASE_CONFIG_FILE"),
  );
  const baseConfig = JSON.parse(await readFile(baseConfigPath, "utf8"));
  validateBaseConfig(baseConfig, config);

  console.log(`Target: context=${config.KUBE_CONTEXT} namespace=${config.NAMESPACE}`);
  console.log(`APP image: ${config.APP_IMAGE}`);
  console.log(`AgentSphere template image: ${config.AGENTSPHERE_TEMPLATE_IMAGE}`);
  console.log(`AgentSphere template: ${config.AGENTSPHERE_TEMPLATE_ID}`);
  if (args.dryRun) {
    const channel = config.CHANNEL_PUBLIC_URL === "auto"
      ? `ws://<cce-load-balancer>:${config.CHANNEL_SERVICE_PORT}/connect`
      : config.CHANNEL_PUBLIC_URL;
    const resources = buildResources({ config, secrets, baseConfig, channelPublicUrl: channel });
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          resources: [
            `${resources.namespace.kind}/${resources.namespace.metadata.name}`,
            `${resources.appService.kind}/${resources.appService.metadata.name}`,
            `${resources.channelService.kind}/${resources.channelService.metadata.name}`,
            `${resources.configMap.kind}/${resources.configMap.metadata.name}`,
            `${resources.secret.kind}/${resources.secret.metadata.name} (content redacted)`,
            `${resources.deployment.kind}/${resources.deployment.metadata.name}`,
          ],
          channelPublicUrl: channel,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.serverDryRun) {
    const { namespaceExists } = clusterPreflight(config);
    const channelPublicUrl = config.CHANNEL_PUBLIC_URL === "auto"
      ? `ws://127.0.0.1:${config.CHANNEL_SERVICE_PORT}/connect`
      : config.CHANNEL_PUBLIC_URL;
    const resources = buildResources({ config, secrets, baseConfig, channelPublicUrl });
    const plan = serverDryRunPlan(resources, namespaceExists);
    if (plan.namespaceToCreate) {
      applyResource(config, plan.namespaceToCreate);
      console.log(`Created namespace ${config.NAMESPACE} from NAMESPACE config.`);
    }
    for (const resource of plan.resourcesToValidate) {
      applyResource(config, resource, { serverDryRun: true });
    }
    console.log(
      namespaceExists
        ? "CCE server-side dry-run passed; no resources were persisted."
        : `CCE server-side dry-run passed; namespace ${config.NAMESPACE} was created; ` +
          "all other resources were not persisted.",
    );
    return;
  }

  clusterPreflight(config);
  if (args.checkCluster) return;
  const initialResources = buildResources({
    config,
    secrets,
    baseConfig,
    channelPublicUrl:
      config.CHANNEL_PUBLIC_URL === "auto"
        ? `ws://127.0.0.1:${config.CHANNEL_SERVICE_PORT}/connect`
        : config.CHANNEL_PUBLIC_URL,
  });
  applyResource(config, initialResources.namespace);
  await waitForPullSecret(config);
  applyResource(config, initialResources.appService);
  applyResource(config, initialResources.channelService);

  let channelPublicUrl = config.CHANNEL_PUBLIC_URL;
  if (channelPublicUrl === "auto") {
    console.log("Waiting for the CCE LoadBalancer address...");
    const address = await waitForLoadBalancer(config);
    channelPublicUrl = `ws://${address}:${config.CHANNEL_SERVICE_PORT}/connect`;
  }

  const resources = buildResources({ config, secrets, baseConfig, channelPublicUrl });
  applyResource(config, resources.configMap);
  applyResource(config, resources.secret);
  applyResource(config, resources.deployment);
  runKubectl(config, [
    "-n",
    config.NAMESPACE,
    "rollout",
    "status",
    `deployment/${APP_NAME}`,
    "--timeout=10m",
  ]);
  validateRuntimeDns(config);
  const uiConfig = runKubectl(
    config,
    [
      "-n",
      config.NAMESPACE,
      "exec",
      `deployment/${APP_NAME}`,
      "--",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3000/api/ui-config').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())})",
    ],
    { capture: true },
  ).trim();
  const actual = JSON.parse(uiConfig);
  validateUiConfig(actual, config);
  console.log(`Deployment verified: provider=${actual.providerId}`);
  console.log(`Channel URL: ${channelPublicUrl}`);
  if (config.APP_PUBLIC_URL) console.log(`APP URL: ${config.APP_PUBLIC_URL}`);
  else console.log(`APP Service: ${config.APP_SERVICE_TYPE} port ${config.APP_SERVICE_PORT}`);
}

const isEntrypoint = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  buildResources,
  appServiceResource,
  channelServiceResource,
  clusterPreflight,
  normalizedConfig,
  parseArgs,
  parseEnvText,
  providerConfig,
  runtimeDnsHosts,
  serverDryRunPlan,
  validateBaseConfig,
  validateUiConfig,
};
