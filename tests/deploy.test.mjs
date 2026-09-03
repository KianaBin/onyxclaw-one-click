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
  KUBECONFIG: "/tmp/test-kubeconfig.yaml",
  AGENTSPHERE_SANDBOX_URL: "https://sandbox.example.test",
  AGENTSPHERE_TEMPLATE_ID: "template-123",
  SFS_TURBO_ID: "sfs-123",
  APP_IMAGE: "registry.example.test/onyxclaw-app:v1@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    JSON.parse(resources.channelService.metadata.annotations["kubernetes.io/elb.autocreate"]).type,
    "inner",
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

test("public-elb APP access allocates a public ELB EIP instead of a node NodePort", () => {
  const config = normalizedConfig({ ...rawConfig, APP_ACCESS_MODE: "public-elb" });
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

  assert.equal(config.APP_PUBLIC_URL, "auto");
  assert.equal(resources.appService.spec.type, "LoadBalancer");
  assert.equal(resources.appService.spec.ports[0].port, 80);
  assert.equal(resources.appService.spec.ports[0].nodePort, undefined);
  assert.deepEqual(
    JSON.parse(resources.appService.metadata.annotations["kubernetes.io/elb.autocreate"]),
    {
      type: "public",
      name: "onyxclaw-app",
      bandwidth_name: "onyxclaw-app-bandwidth",
      bandwidth_chargemode: "traffic",
      bandwidth_size: 5,
      bandwidth_sharetype: "PER",
      eip_type: "5_bgp",
    },
  );
});

test("APP access mode accepts only the supported first-deployment choices", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, APP_ACCESS_MODE: "ingress" }),
    /APP_ACCESS_MODE must be nodeport or public-elb/,
  );
});

test("fixed profile always uses a LoadBalancer for the Channel", () => {
  assert.equal(
    normalizedConfig({ ...rawConfig, CHANNEL_SERVICE_TYPE: "ClusterIP" }).CHANNEL_SERVICE_TYPE,
    "LoadBalancer",
  );
});

test("CCE auto-creates the private Channel ELB in the fixed profile", () => {
  const config = normalizedConfig(rawConfig);
  assert.deepEqual(
    JSON.parse(config.CHANNEL_SERVICE_ANNOTATIONS["kubernetes.io/elb.autocreate"]),
    { type: "inner", name: "onyxclaw-channel" },
  );
});

test("image versions are read from config.env while fixed deployment settings remain fixed", () => {
  const config = normalizedConfig({
    ...rawConfig,
    APP_IMAGE: "swr.example.test/app:v2@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    REGION: "other-region",
    CHANNEL_SERVICE_ANNOTATIONS_JSON: "{}",
    MODEL_ID: "other-model",
  });
  assert.equal(config.REGION, "cn-south-1");
  assert.equal(config.APP_IMAGE, "swr.example.test/app:v2@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(config.MODEL_ID, "deepseek-v4-flash");
  assert.equal(config.NAMESPACE, "onyxclaw");
  assert.equal(config.KUBE_CONTEXT, "");
  assert.equal(config.APP_ACCESS_MODE, "nodeport");
  assert.throws(
    () => normalizedConfig({ ...rawConfig, KUBECONFIG: "relative.yaml" }),
    /absolute path/,
  );
  assert.throws(
    () => normalizedConfig({ ...rawConfig, APP_IMAGE: "swr.example.test/app:mutable" }),
    /APP_IMAGE must be an immutable/,
  );
});

test("the fixed AgentSphere profile includes pause/resume and requires SFS Turbo", () => {
  const config = normalizedConfig(rawConfig);
  assert.equal(config.PAUSE_RESUME, true);
  assert.equal(config.MEMORY_PERSISTENCE, true);
  assert.equal(config.SANDBOX_ON_TIMEOUT, "pause");
  assert.throws(
    () => normalizedConfig({ ...rawConfig, SFS_TURBO_ID: "" }),
    /SFS_TURBO_ID is required/,
  );
});

test("APP image is required in config.env", () => {
  assert.throws(
    () => normalizedConfig({ ...rawConfig, APP_IMAGE: "" }),
    /APP_IMAGE is required/,
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
  assert.equal(missing.namespaceToCreate.metadata.name, "onyxclaw");
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
    "agentsphere.cn-south-1.myhuaweicloud.com",
    "sandbox.example.test",
  ]);
  assert.deepEqual(runtimeDnsHosts({
    ...config,
    AGENTSPHERE_SANDBOX_URL: config.AGENTSPHERE_API_URL,
  }), ["agentsphere.cn-south-1.myhuaweicloud.com"]);
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
