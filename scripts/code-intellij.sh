#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

set -euo pipefail
INTELLIJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTELLIJ_PROFILE="$INTELLIJ_ROOT/.profile-oss/intellij"
if [[ ! -f "$INTELLIJ_PROFILE/tooling.json" ]]; then
	node "$INTELLIJ_ROOT/scripts/intellij/setup.ts"
fi
pnpm -C "$INTELLIJ_ROOT" run build-fast
exec env -u ELECTRON_RUN_AS_NODE -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS "$INTELLIJ_ROOT/scripts/code.sh" --user-data-dir "$INTELLIJ_PROFILE/user-data" --extensions-dir "$INTELLIJ_PROFILE/extensions" --shared-data-dir "$INTELLIJ_PROFILE/shared-data" "$@"
