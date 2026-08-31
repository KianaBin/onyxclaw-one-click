import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResources,
  normalizedConfig,
  parseArgs,
  parseEnvText,
  runtimeDnsHosts,
  serverDryRunPlan,
  validateUiConfig,
  validateBaseConfig,
} from "../scripts/deploy.mjs";

const rawConfig = {
  KUBE_CONTEXT: "test-context",
  KUBECONFIG: "/tmp/test-kubeconfig.yaml",
  NAMESPACE: "onyxclaw-test",
  REGION: "cn-south-1",
  APP_IMAGE: `swr.example.test/onyxclaw/app@sha256:${"a".repeat(64)}`,
  AGENTSPHERE_API_URL: "https://agentsphere.example.test",
  AGENTSPHERE_SANDBOX_URL: "https://sandbox.example.test",
  AGENTSPHERE_TEMPLATE_IMAGE:
    `swr.example.test/onyxclaw/openclaw@sha256:${"b".repeat(64)}`,
  AGENTSPHERE_TEMPLATE_ID: "template-123",
  AGENTSPHERE_TEMPLATE_READY: "true",
  APP_SERVICE_TYPE: "NodePort",
  APP_NODE_PORT: "30080",
  CHANNEL_SERVICE_TYPE: "LoadBalancer",
  CHANNEL_SERVICE_ANNOTATIONS_JSON:
    '{"kubernetes.io/elb.id":"elb-123","kubernetes.io/elb.class":"union"}',
  CHANNEL_PUBLIC_URL: "auto",
  MODEL_PROVIDER: "deepseek",
  MODEL_ID: "deepseek-v4-flash",
  PAUSE_RESUME: "true",
  MEMORY_PERSISTENCE: "true",
  SFS_TURBO_ID: "sfs-123",
  SFS_SHARE_PATH: "/onyxclaw/workspace",
};

const baseConfig = {
  agents: { defaults: { model: { primary: "deepseek/deepseek-v4-flash" } } },
  models: {
    providers: {
      deepseek: { apiKey: "__ONYXCLAW_MODEL_API_KEY__" },
    },
  },
  gateway: { auth: { token: "__ONYXCLAW_GATEWAY_TOKEN__" } },
};

test("env parser does not execute shell syntax", () => {
  assert.deepEqual(parseEnvText("A=$(touch nope)\nB='quoted value'\n"), {
    A: "$(touch nope)",
    B: "quoted value",
  });
});

test("one-click config renders a private CCE deployment without embedding secrets", () => {
  const config = normalizedConfig(rawConfig);
  validateBaseConfig(baseConfig, config);
  const resources = buildResources({
    config,
    secrets: {
      AGENTSPHERE_E2B_API_KEY: "e2b-secret",
      MODEL_API_KEY: "model-secret",
      CHANNEL_SIGNING_SECRET: "channel-secret",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
    },
    baseConfig,
    channelPublicUrl: "ws://192.168.1.50:18890/connect",
  });

  const provider = JSON.parse(resources.configMap.data["providers.agentsphere.json"]);
  assert.equal(provider.defaultProvider, "huaweicloud-agentsphere");
  assert.equal(
    provider.providers["huaweicloud-agentsphere"].channel.publicUrl,
    "ws://192.168.1.50:18890/connect",
  );
  assert.equal(
    JSON.parse(
      provider.providers["huaweicloud-agentsphere"].sandbox.metadata[
        "agentsandbox.storage.sfs"
      ],
    ).sfsTurboMounts[0].sfsTurboId,
    "sfs-123",
  );
  assert.doesNotMatch(JSON.stringify(resources.configMap), /e2b-secret|model-secret|channel-secret/);
  assert.equal(resources.secret.stringData["agentsphere-e2b-api-key"], "e2b-secret");
  assert.match(
    resources.secret.stringData["openclaw-base-config-json"],
    /__ONYXCLAW_MODEL_API_KEY__/,
  );
  assert.doesNotMatch(
    resources.secret.stringData["openclaw-base-config-json"],
    /__ONYXCLAW_GATEWAY_TOKEN__/,
  );
  assert.match(
    resources.secret.stringData["openclaw-base-config-json"],
    /gateway-secret/,
  );
  assert.match(
    resources.deployment.spec.template.metadata.annotations[
      "onyxclaw.io/runtime-config-checksum"
    ],
    /^[0-9a-f]{64}$/,
  );
  assert.doesNotMatch(
    resources.deployment.spec.template.metadata.annotations[
      "onyxclaw.io/runtime-config-checksum"
    ],
    /secret/,
  );
  assert.equal(resources.appService.spec.type, "NodePort");
  assert.equal(resources.appService.spec.ports[0].nodePort, 30080);
  assert.equal(resources.channelService.spec.type, "LoadBalancer");
  assert.equal(
    resources.channelService.metadata.annotations["kubernetes.io/elb.id"],
    "elb-123",
  );
  assert.deepEqual(resources.deployment.spec.template.spec.imagePullSecrets, undefined);
  for (const resource of [
    resources.namespace,
    resources.appService,
    resources.channelService,
    resources.configMap,
    resources.secret,
    resources.deployment,
  ]) {
    assert.equal(
      resource.metadata.labels["app.kubernetes.io/managed-by"],
      "onyxclaw-one-click",
    );
  }
});

test("auto Channel URL is rejected when CCE cannot allocate a LoadBalancer", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, CHANNEL_SERVICE_TYPE: "ClusterIP" }),
    /requires CHANNEL_SERVICE_TYPE=LoadBalancer/,
  );
});

test("CCE can auto-create the private Channel ELB", () => {
  const config = normalizedConfig({
    ...rawConfig,
    CHANNEL_SERVICE_ANNOTATIONS_JSON:
      '{"kubernetes.io/elb.class":"union","kubernetes.io/elb.autocreate":"{\\"type\\":\\"inner\\",\\"name\\":\\"onyxclaw-channel\\"}"}',
  });
  assert.deepEqual(
    JSON.parse(config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"]),
    { type: "inner", name: "onyxclaw-channel" },
  );
});

test("Channel ELB annotations reject ambiguous or invalid auto-create settings", () => {
  assert.throws(
    () =>
      normalizedConfig({
        ...rawConfig,
        CHANNEL_SERVICE_ANNOTATIONS_JSON:
          '{"kubernetes.io/elb.id":"elb-123","kubernetes.io/elb.autocreate":"{\\"type\\":\\"inner\\"}"}',
      }),
    /must not configure both/,
  );
  assert.throws(
    () =>
      normalizedConfig({
        ...rawConfig,
        CHANNEL_SERVICE_ANNOTATIONS_JSON:
          '{"kubernetes.io/elb.autocreate":"not-json"}',
      }),
    /elb\.autocreate must be valid JSON/,
  );
});

test("mutable image tags and implicit cluster targets are rejected", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, APP_IMAGE: "swr.example.test/app:v19" }),
    /immutable image/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, KUBE_CONTEXT: "" }),
    /KUBE_CONTEXT is required/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, NAMESPACE: "" }),
    /NAMESPACE is required/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, KUBECONFIG: "relative.yaml" }),
    /absolute path/,
  );
});

test("the supported AgentSphere profile requires pause/resume and SFS Turbo", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, PAUSE_RESUME: "false" }),
    /PAUSE_RESUME must be true/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, MEMORY_PERSISTENCE: "false" }),
    /MEMORY_PERSISTENCE must be true/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, SFS_TURBO_ID: "" }),
    /SFS_TURBO_ID is required/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, SANDBOX_ON_TIMEOUT: "kill" }),
    /must be pause/,
  );
});

test("manual AgentSphere Template readiness is an explicit deployment gate", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, AGENTSPHERE_TEMPLATE_READY: "false" }),
    /must be true/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, AGENTSPHERE_TEMPLATE_IMAGE: "image:latest" }),
    /AGENTSPHERE_TEMPLATE_IMAGE must be an immutable image/,
  );
});

test("changing runtime secrets changes the rollout checksum without exposing values", () => {
  const config = normalizedConfig(rawConfig);
  const create = (modelKey) => buildResources({
    config,
    secrets: {
      AGENTSPHERE_E2B_API_KEY: "e2b-secret",
      MODEL_API_KEY: modelKey,
      CHANNEL_SIGNING_SECRET: "channel-secret",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
    },
    baseConfig,
    channelPublicUrl: "ws://192.168.1.50:18890/connect",
  }).deployment.spec.template.metadata.annotations[
    "onyxclaw.io/runtime-config-checksum"
  ];
  const first = create("model-key-one");
  const second = create("model-key-two");
  assert.notEqual(first, second);
  assert.doesNotMatch(first + second, /model-key/);
});

test("CLI modes are explicit and mutually exclusive", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--config", "c", "--secrets", "s"]), {
    dryRun: true,
    checkCluster: false,
    serverDryRun: false,
    configPath: "c",
    secretsPath: "s",
  });
  assert.equal(parseArgs(["--check-cluster"]).checkCluster, true);
  assert.equal(parseArgs(["--server-dry-run"]).serverDryRun, true);
  assert.throws(
    () => parseArgs(["--dry-run", "--check-cluster"]),
    /mutually exclusive/,
  );
});

test("server dry-run creates a missing configured namespace before validating namespaced resources", () => {
  const resources = buildResources({
    config: normalizedConfig(rawConfig),
    secrets: {
      AGENTSPHERE_E2B_API_KEY: "e2b-secret",
      MODEL_API_KEY: "model-secret",
      CHANNEL_SIGNING_SECRET: "channel-secret",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
    },
    baseConfig,
    channelPublicUrl: "ws://127.0.0.1:18890/connect",
  });
  const missing = serverDryRunPlan(resources, false);
  assert.equal(missing.namespaceToCreate.kind, "Namespace");
  assert.equal(missing.namespaceToCreate.metadata.name, "onyxclaw-test");
  assert.deepEqual(
    missing.resourcesToValidate.map((resource) => resource.kind),
    ["Service", "Service", "ConfigMap", "Secret", "Deployment"],
  );

  const existing = serverDryRunPlan(resources, true);
  assert.equal(existing.namespaceToCreate, null);
  assert.equal(existing.resourcesToValidate[0].kind, "Namespace");
});

test("runtime DNS validation targets both AgentSphere control and private data planes", () => {
  const config = normalizedConfig(rawConfig);
  assert.deepEqual(runtimeDnsHosts(config), [
    "agentsphere.example.test",
    "sandbox.example.test",
  ]);
  assert.deepEqual(runtimeDnsHosts({
    ...config,
    AGENTSPHERE_SANDBOX_URL: config.AGENTSPHERE_API_URL,
  }), ["agentsphere.example.test"]);
});

test("deployed APP identity must match all requested cloud inputs", () => {
  const config = normalizedConfig(rawConfig);
  const actual = {
    deploymentMode: "cloud",
    providerId: "huaweicloud-agentsphere",
    region: "cn-south-1",
    templateId: "template-123",
    modelProvider: "deepseek",
    modelName: "deepseek-v4-flash",
  };
  assert.equal(validateUiConfig(actual, config), actual);
  assert.throws(
    () => validateUiConfig({ ...actual, templateId: "wrong-template" }, config),
    /templateId/,
  );
});
