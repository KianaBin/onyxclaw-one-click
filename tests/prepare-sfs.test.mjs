import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrides, parseArgs, parseNfsEndpoint } from "../scripts/prepare-sfs.mjs";

test("SFS CLI requires explicit cluster identity and a root endpoint", () => {
  assert.deepEqual(parseArgs([
    "--kubeconfig", "/tmp/cce.yaml",
    "--context", "onyxclaw-demo-test",
    "--nfs-endpoint", "192.168.0.2:/",
  ]), {
    kubeconfig: "/tmp/cce.yaml",
    context: "onyxclaw-demo-test",
    nfs_endpoint: "192.168.0.2:/",
    namespace: "default",
    sharePath: "/onyxclaw/workspace",
  });
  assert.deepEqual(parseNfsEndpoint("192.168.0.2:/"), {
    server: "192.168.0.2",
    exportPath: "/",
  });
});

test("unsafe SFS paths and endpoints are rejected", () => {
  assert.throws(() => parseNfsEndpoint("192.168.0.2"), /must look like/);
  assert.throws(() => parseArgs([
    "--kubeconfig", "/tmp/cce.yaml",
    "--context", "demo",
    "--nfs-endpoint", "192.168.0.2:/",
    "--share-path", "/../secret",
  ]), /safe absolute directory/);
});

test("SFS helper uses the pinned image, NFS root and UID 1000 write test", () => {
  const overrides = buildOverrides({
    server: "192.168.0.2",
    exportPath: "/",
    sharePath: "/onyxclaw/workspace",
  });
  const container = overrides.spec.containers[0];
  assert.match(container.image, /@sha256:[0-9a-f]{64}$/);
  assert.deepEqual(overrides.spec.volumes[0].nfs, {
    server: "192.168.0.2",
    path: "/",
    readOnly: false,
  });
  assert.match(container.command[2], /chown 1000:1000/);
  assert.match(container.command[2], /SFS_PREPARE_OK/);
});
