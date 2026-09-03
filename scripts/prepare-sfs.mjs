#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnvText } from "./deploy.mjs";

const POD_NAME = "onyxclaw-sfs-prepare";

export function parseArgs(argv) {
  const result = { namespace: "default", sharePath: "/onyxclaw/workspace" };
  const keys = {
    "--kubeconfig": "kubeconfig",
    "--config": "configPath",
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
  for (const name of ["configPath", "kubeconfig", "nfs_endpoint"]) {
    if (!result[name]) throw new Error(`--${name.replaceAll("_", "-")} is required`);
  }
  for (const name of ["configPath", "kubeconfig"]) {
    if (!path.isAbsolute(result[name])) throw new Error(`--${name === "configPath" ? "config" : "kubeconfig"} must be an absolute path`);
  }
  if (result.context && !/^[A-Za-z0-9._-]+$/.test(result.context)) {
    throw new Error("--context contains unsafe characters");
  }
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

export function appImageFromConfig(configPath) {
  const image = parseEnvText(readFileSync(configPath, "utf8"), configPath).APP_IMAGE?.trim();
  if (!image || !/@sha256:[0-9a-f]{64}$/i.test(image)) {
    throw new Error("APP_IMAGE in config must be an immutable image@sha256:<64-hex-digest> reference");
  }
  return image;
}

export function buildOverrides({ server, exportPath, sharePath, appImage }) {
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
        image: appImage,
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
    ...(config.context ? ["--context", config.context] : []),
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
  const appImage = appImageFromConfig(config.configPath);
  const existing = kubectl(config, [
    "get", "pod", POD_NAME, "-n", config.namespace, "--ignore-not-found", "-o", "name",
  ]).stdout.trim();
  if (existing) throw new Error(`${config.namespace}/${POD_NAME} already exists; inspect it before retrying`);

  const overrides = JSON.stringify(buildOverrides({ ...endpoint, sharePath: config.sharePath, appImage }));
  kubectl(config, [
    "run", POD_NAME,
    "-n", config.namespace,
    `--image=${appImage}`,
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
