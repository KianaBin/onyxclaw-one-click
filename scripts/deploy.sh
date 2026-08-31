#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
package_dir="$(CDPATH= cd -- "${script_dir}/.." && pwd)"

exec node "$script_dir/deploy.mjs" \
  --config "$package_dir/config/config.env" \
  --secrets "$package_dir/config/secrets.env" \
  "$@"
