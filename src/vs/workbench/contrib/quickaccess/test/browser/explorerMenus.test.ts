/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Context } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NEW_FILE_COMMAND_ID, NEW_FOLDER_COMMAND_ID } from '../../../files/browser/fileActions.js';
import { explorerNewMenu } from '../../../intellij/browser/explorerMenus.js';
import '../../../files/browser/fileActions.contribution.js';

suite('IntelliJ Explorer menus', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups the native file and folder commands under New without duplicate top-level entries', () => {
		const contextMenu = MenuRegistry.getMenuItems(MenuId.ExplorerContext);
		const commands = MenuRegistry.getMenuItems(explorerNewMenu).filter(isIMenuItem);
		assert.deepStrictEqual({
			parents: contextMenu.filter(item => !isIMenuItem(item) && item.submenu === explorerNewMenu).length,
			commands: commands.map(item => item.command.id),
			topLevelDuplicates: contextMenu.filter(isIMenuItem).filter(item => [NEW_FILE_COMMAND_ID, NEW_FOLDER_COMMAND_ID].includes(item.command.id)).length
		}, { parents: 1, commands: [NEW_FILE_COMMAND_ID, NEW_FOLDER_COMMAND_ID], topLevelDuplicates: 0 });
	});

	test('creation remains available from files and folders while preserving native read-only protection', () => {
		const commands = MenuRegistry.getMenuItems(explorerNewMenu).filter(isIMenuItem);
		const states = [false, true].flatMap(isFolder => [false, true].map(readonly => {
			const context = new Context(0, null);
			context.setValue('explorerResourceIsFolder', isFolder);
			context.setValue('explorerResourceReadonly', readonly);
			return commands.map(item => (!item.when || item.when.evaluate(context)) && (!item.command.precondition || item.command.precondition.evaluate(context)));
		}));
		assert.deepStrictEqual(states, [[true, true], [false, false], [true, true], [false, false]]);
	});
});
