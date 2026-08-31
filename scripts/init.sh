#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "${script_dir}/.." && pwd)"
config_dir="${package_dir}/config"

create_from_example() {
  local example_name="$1"
  local output_name="$2"
  local output_path="${config_dir}/${output_name}"

  if [[ -e "${output_path}" ]]; then
    printf '保留已有文件：%s\n' "${output_name}"
    return
  fi

  cp "${config_dir}/${example_name}" "${output_path}"
  chmod 600 "${output_path}"
  printf '已创建：%s\n' "${output_name}"
}

create_from_example config.env.example config.env
create_from_example secrets.env.example secrets.env
create_from_example openclaw-base-config.example.json openclaw-base-config.json

printf '请填写 config/ 下的三个文件，然后执行 node scripts/deploy.mjs --config config/config.env --secrets config/secrets.env --dry-run\n'
