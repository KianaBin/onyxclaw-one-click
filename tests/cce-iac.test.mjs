import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../iac/cce/main.tf", import.meta.url), "utf8");
const variables = readFileSync(new URL("../iac/cce/variables.tf", import.meta.url), "utf8");
const network = readFileSync(new URL("../iac/cce/network.tf", import.meta.url), "utf8");
const egress = readFileSync(new URL("../iac/cce/egress.tf", import.meta.url), "utf8");
const storage = readFileSync(new URL("../iac/cce/storage.tf", import.meta.url), "utf8");

test("CCE resource tags do not use Kubernetes label keys rejected by the CCE API", () => {
  const match = main.match(/cce_tags = merge\(var\.cluster_tags, \{([\s\S]*?)\n  \}\)/);
  assert.ok(match, "CCE resource tags must have an explicit local definition");

  const fixedKeys = [...match[1].matchAll(/^(\s*)([A-Za-z0-9_.-]+)\s*=/gm)]
    .map((entry) => entry[2]);
  assert.deepEqual(fixedKeys, ["app", "managed_by"]);
  for (const key of fixedKeys) {
    assert.doesNotMatch(key, /[=\\*<>\\,|/]/);
  }
  assert.match(variables, /!strcontains\(key, "\/"\)/);
});

test("IaC selects either new or existing network resources and optionally manages egress/storage", () => {
  assert.match(network, /resource "huaweicloud_vpc" "this"/);
  assert.match(network, /count = var\.network_mode == "create" \? 1 : 0/);
  assert.match(network, /var\.network_mode == "existing" \? var\.existing_vpc_id/);
  assert.match(network, /var\.network_mode == "existing" \? var\.existing_subnet_id/);
  assert.match(network, /target_vpc_id/);
  assert.match(network, /target_subnet_id/);
  assert.match(variables, /variable "network_mode"/);
  assert.match(variables, /variable "existing_vpc_id"/);
  assert.match(variables, /variable "existing_subnet_id"/);
  assert.match(main, /network_mode=existing requires both existing_vpc_id and existing_subnet_id/);

  assert.match(variables, /variable "manage_snat"/);
  assert.match(egress, /resource "huaweicloud_nat_gateway" "this"/);
  assert.match(egress, /resource "huaweicloud_nat_snat_rule" "this"/);
  assert.match(egress, /floating_ip_id = huaweicloud_vpc_eip\.snat\[0\]\.id/);

  assert.match(variables, /variable "manage_sfs"/);
  assert.match(storage, /resource "huaweicloud_sfs_turbo" "this"/);
  assert.match(storage, /share_proto\s+= "NFS"/);

  assert.doesNotMatch(variables, /manage_swr|swr_organization_name|swr_repository_name/);
});

test("IaC does not manage application configuration or require a local provider", () => {
  assert.doesNotMatch(variables, /write_app_config|app_config_path|app_kubeconfig_path/);
  assert.doesNotMatch(variables, /agentsphere_sandbox_url|agentsphere_template_id/);
  assert.doesNotMatch(storage, /existing_sfs_turbo_id|target_sfs_turbo_id/);
  const versions = readFileSync(new URL("../iac/cce/versions.tf", import.meta.url), "utf8");
  assert.doesNotMatch(versions, /hashicorp\/local/);
});
