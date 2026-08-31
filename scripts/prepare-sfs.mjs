#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const POD_NAME = "onyxclaw-sfs-prepare";
const APP_IMAGE = "swr.cn-south-1.myhuaweicloud.com/demo-test/onyxclaw-app:0.3.8-session-routing-debug-nodelay-wait5s-v19@sha256:fe0c5274fff79897fce53634756694edc9799f393e3e3dde416d604749788293";

export function parseArgs(argv) {
  const result = { namespace: "default", sharePath: "/onyxclaw/workspace" };
  const keys = {
    "--kubeconfig": "kubeconfig",
    "--context": "context",
    "--nfs-endpoint": "nfs_endpoint",
    "--share-path": "sharePath",
    "--namespace": "namespace",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!keys[key]) {
      throw new Error(`unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    result[keys[key]] = value;
    index += 1;
  }
  for (const name of ["kubeconfig", "context", "nfs_endpoint"]) {
    if (!result[name]) throw new Error(`--${name.replaceAll("_", "-")} is required`);
  }
  if (!path.isAbsolute(result.kubeconfig)) throw new Error("--kubeconfig must be an absolute path");
  if (!/^[A-Za-z0-9._-]+$/.test(result.context)) throw new Error("--context contains unsafe characters");
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(result.namespace)) {
    throw new Error("--namespace must be a Kubernetes namespace name");
  }
  validateSharePath(result.sharePath);
  return result;
}

export function parseNfsEndpoint(value) {
  const match = /^([A-Za-z0-9.-]+):(\/[^\s]*)$/.exec(value);
  if (!match) throw new Error("--nfs-endpoint must look like 192.168.0.2:/");
  return { server: match[1], exportPath: match[2] };
}

export function validateSharePath(value) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value === "/" || value.includes("..") || value.includes("//")) {
    throw new Error("--share-path must be a safe absolute directory below the SFS root");
  }
  return value;
}

export function buildOverrides({ server, exportPath, sharePath }) {
  const mountedPath = `/sfs${sharePath}`;
  const testFile = `${mountedPath}/.onyxclaw-write-test`;
  const command = [
    "set -eu",
    `mkdir -p ${mountedPath}`,
    `chown 1000:1000 ${mountedPath}`,
    `su -s /bin/sh node -c \"touch ${testFile}; rm ${testFile}\"`,
    `stat -c \"directory-owner=%u:%g mode=%a path=%n\" ${mountedPath}`,
    "echo SFS_PREPARE_OK",
  ].join("; ");

  return {
    spec: {
      securityContext: { runAsUser: 0, runAsGroup: 0 },
      containers: [{
        name: POD_NAME,
        image: APP_IMAGE,
        securityContext: { runAsUser: 0, runAsGroup: 0 },
        command: ["sh", "-c", command],
        volumeMounts: [{ name: "sfs", mountPath: "/sfs" }],
      }],
      volumes: [{ name: "sfs", nfs: { server, path: exportPath, readOnly: false } }],
    },
  };
}

function kubectl(config, args, { allowFailure = false } = {}) {
  const result = spawnSync("kubectl", [
    "--kubeconfig", config.kubeconfig,
    "--context", config.context,
    ...args,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "kubectl failed").trim());
  }
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const endpoint = parseNfsEndpoint(config.nfs_endpoint);
  const existing = kubectl(config, [
    "get", "pod", POD_NAME, "-n", config.namespace, "--ignore-not-found", "-o", "name",
  ]).stdout.trim();
  if (existing) throw new Error(`${config.namespace}/${POD_NAME} already exists; inspect it before retrying`);

  const overrides = JSON.stringify(buildOverrides({ ...endpoint, sharePath: config.sharePath }));
  kubectl(config, [
    "run", POD_NAME,
    "-n", config.namespace,
    `--image=${APP_IMAGE}`,
    "--restart=Never",
    `--overrides=${overrides}`,
  ]);

  const waited = kubectl(config, [
    "wait", "-n", config.namespace,
    "--for=jsonpath={.status.phase}=Succeeded",
    `pod/${POD_NAME}`,
    "--timeout=120s",
  ], { allowFailure: true });

  if (waited.status !== 0) {
    const details = kubectl(config, ["describe", "pod", POD_NAME, "-n", config.namespace], { allowFailure: true });
    const logs = kubectl(config, ["logs", "pod/" + POD_NAME, "-n", config.namespace], { allowFailure: true });
    process.stderr.write(details.stdout || details.stderr || "");
    process.stderr.write(logs.stdout || logs.stderr || "");
    throw new Error(`SFS preparation failed; ${config.namespace}/${POD_NAME} was retained for diagnosis`);
  }

  const logs = kubectl(config, ["logs", `pod/${POD_NAME}`, "-n", config.namespace]).stdout;
  if (!logs.includes("SFS_PREPARE_OK")) {
    throw new Error(`SFS success marker missing; ${config.namespace}/${POD_NAME} was retained for diagnosis`);
  }
  process.stdout.write(logs);
  kubectl(config, ["delete", "pod", POD_NAME, "-n", config.namespace, "--wait=true"]);
  process.stdout.write(`Deleted temporary pod ${config.namespace}/${POD_NAME}\n`);
}

if (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`prepare-sfs: ${error.message}\n`);
    process.exitCode = 1;
  }
}
