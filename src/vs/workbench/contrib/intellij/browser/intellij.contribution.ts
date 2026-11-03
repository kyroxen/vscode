/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions, IQuickAccessRegistry } from '../../../../platform/quickinput/common/quickAccess.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { SourceOriginContribution } from './sourceOrigin.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IntelliJClassQuickAccessProvider, IntelliJGoToClassAction } from './classSearch.js';
import { IntelliJQuickAccessProvider, IntelliJSearchEverywhereAction } from './searchEverywhere.js';

Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
	ctor: IntelliJQuickAccessProvider,
	prefix: IntelliJQuickAccessProvider.PREFIX,
	placeholder: localize('intellijSearchEverywherePlaceholder', "Search files, symbols, and actions."),
	helpEntries: [{ description: localize('intellijSearchEverywhereHelp', "Search Everywhere"), commandId: IntelliJSearchEverywhereAction.ID }]
});

registerAction2(IntelliJSearchEverywhereAction);

Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
	ctor: IntelliJClassQuickAccessProvider,
	prefix: IntelliJClassQuickAccessProvider.PREFIX,
	placeholder: localize('intellijClassSearchPlaceholder', "Type a class, interface, enum, or record name."),
	helpEntries: [{ description: localize('intellijClassSearchHelp', "Go to Class"), commandId: IntelliJGoToClassAction.ID }]
});

registerAction2(IntelliJGoToClassAction);

registerWorkbenchContribution2(SourceOriginContribution.ID, SourceOriginContribution, WorkbenchPhase.BlockRestore);
