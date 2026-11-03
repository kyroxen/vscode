/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { SymbolKind } from '../../../../editor/common/languages.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { PickerQuickAccessProvider } from '../../../../platform/quickinput/browser/pickerQuickAccess.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISymbolQuickPickItem, SymbolsQuickAccessProvider } from '../../search/browser/symbolsQuickAccess.js';

/** Filters native symbol picks without replacing their lazy resolution or opening handlers. */
export class IntelliJClassQuickAccessProvider extends PickerQuickAccessProvider<ISymbolQuickPickItem> {
	static readonly PREFIX = 'class ';
	private readonly symbols: SymbolsQuickAccessProvider;

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super(IntelliJClassQuickAccessProvider.PREFIX, {
			canAcceptInBackground: true,
			noResultsPick: { label: localize('noClassResults', "No matching classes, interfaces, enums, or records") }
		});
		this.symbols = this._register(instantiationService.createInstance(SymbolsQuickAccessProvider));
	}

	protected async _getPicks(filter: string, _disposables: DisposableStore, token: CancellationToken): Promise<ISymbolQuickPickItem[]> {
		const picks = await this.symbols.getSymbolPicks(filter, undefined, token);
		return token.isCancellationRequested ? [] : picks.filter(pick => pick.symbol && (
			pick.symbol.kind === SymbolKind.Class || pick.symbol.kind === SymbolKind.Interface || pick.symbol.kind === SymbolKind.Enum || pick.symbol.kind === SymbolKind.Struct
		));
	}
}

export class IntelliJGoToClassAction extends Action2 {
	static readonly ID = 'intellij.goToClass';

	constructor() {
		super({ id: IntelliJGoToClassAction.ID, title: localize2('intellijGoToClass', "Go to Class"), category: localize2('intellijCategory', "IntelliJ"), f1: true });
	}

	override run(accessor: ServicesAccessor): void {
		accessor.get(IQuickInputService).quickAccess.show(IntelliJClassQuickAccessProvider.PREFIX);
	}
}
