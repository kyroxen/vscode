#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

set -euo pipefail
INTELLIJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTELLIJ_TOOLING="${INTELLIJ_TOOLING:-all}"
if [[ "${1:-}" == "--tooling" ]]; then
	INTELLIJ_TOOLING="${2:?Expected all, java, or javascript after --tooling}"
	shift 2
fi
case "$INTELLIJ_TOOLING" in
	all) INTELLIJ_PROFILE="$INTELLIJ_ROOT/.profile-oss/intellij" ;;
	java|javascript) INTELLIJ_PROFILE="$INTELLIJ_ROOT/.profile-oss/intellij-$INTELLIJ_TOOLING" ;;
	*) echo "Expected --tooling all, java, or javascript" >&2; exit 1 ;;
esac
if ! node "$INTELLIJ_ROOT/scripts/intellij/setup.ts" --check --tooling "$INTELLIJ_TOOLING" --profile "$INTELLIJ_PROFILE"; then
	node "$INTELLIJ_ROOT/scripts/intellij/setup.ts" --tooling "$INTELLIJ_TOOLING" --profile "$INTELLIJ_PROFILE"
fi
pnpm -C "$INTELLIJ_ROOT" run build-fast
exec env -u ELECTRON_RUN_AS_NODE -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS "$INTELLIJ_ROOT/scripts/code.sh" --user-data-dir "$INTELLIJ_PROFILE/user-data" --extensions-dir "$INTELLIJ_PROFILE/extensions" --shared-data-dir "$INTELLIJ_PROFILE/shared-data" "$@"
