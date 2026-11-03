/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';

/** Native creation commands register here instead of directly in the Explorer context menu. */
export const explorerNewMenu = new MenuId('intellij.explorer.new');

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	submenu: explorerNewMenu,
	title: localize('explorerNew', "New"),
	group: 'navigation',
	order: 4
});
