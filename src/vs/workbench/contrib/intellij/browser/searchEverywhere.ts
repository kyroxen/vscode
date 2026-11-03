/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { hasKey } from '../../../../base/common/types.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { FastAndSlowPicks, IPickerQuickAccessItem, PickerQuickAccessProvider, Picks } from '../../../../platform/quickinput/browser/pickerQuickAccess.js';
import { IQuickAccessProviderRunOptions } from '../../../../platform/quickinput/common/quickAccess.js';
import { IQuickInputService, IQuickPick, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { AnythingQuickAccessProvider } from '../../search/browser/anythingQuickAccess.js';
import { SymbolsQuickAccessProvider } from '../../search/browser/symbolsQuickAccess.js';
import { CommandsQuickAccessProvider } from '../../quickaccess/browser/commandsQuickAccess.js';

/** Keeps command filtering, history, keybindings, and error reporting in the upstream provider. */
export class SearchEverywhereCommandsProvider extends CommandsQuickAccessProvider {
	getPicks(filter: string, disposables: DisposableStore, token: CancellationToken) {
		return super._getPicks(filter, disposables, token);
	}
}

type SearchPick = IPickerQuickAccessItem | IQuickPickSeparator;
type SearchPicks = Picks<IPickerQuickAccessItem> | FastAndSlowPicks<IPickerQuickAccessItem>;

export class IntelliJQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {
	static readonly PREFIX = 'all ';
	private readonly anything: AnythingQuickAccessProvider;
	private readonly commands: SearchEverywhereCommandsProvider;
	private readonly symbols: SymbolsQuickAccessProvider;
	private picker: IQuickPick<IPickerQuickAccessItem, { useSeparators: true }> | undefined;

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super(IntelliJQuickAccessProvider.PREFIX, { canAcceptInBackground: true });
		this.anything = this._register(instantiationService.createInstance(AnythingQuickAccessProvider));
		this.commands = this._register(instantiationService.createInstance(SearchEverywhereCommandsProvider));
		this.symbols = this._register(instantiationService.createInstance(SymbolsQuickAccessProvider));
	}

	override provide(picker: IQuickPick<IPickerQuickAccessItem, { useSeparators: true }>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable {
		const store = new DisposableStore();
		this.picker = picker;
		store.add(toDisposable(() => { if (this.picker === picker) { this.picker = undefined; } }));
		this.anything.beginSearchEverywhere(picker);
		store.add(super.provide(picker, token, runOptions));
		return store;
	}

	protected _getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): null {
		const picker = this.picker!;
		void this.getSearchPicks(filter, disposables, token, (items, busy) => {
			if (disposables.isDisposed) {
				return;
			}
			const active = picker.activeItems[0];
			picker.items = items;
			if (active && items.includes(active)) {
				picker.activeItems = [active];
			}
			picker.busy = busy;
		});
		return null;
	}

	/** Publish each source independently so a slow language server cannot hide ready results. */
	protected async getSearchPicks(filter: string, disposables: DisposableStore, token: CancellationToken, update: (items: readonly SearchPick[], busy: boolean) => void): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const groups: { label: string; items: readonly SearchPick[]; load: () => SearchPicks | Promise<SearchPicks> }[] = [
			{ label: localize('searchEverywhereFiles', "Files"), items: [], load: () => this.anything.getSearchEverywherePicks(filter, token) },
			{ label: localize('searchEverywhereSymbols', "Symbols"), items: [], load: () => filter ? this.symbols.getSymbolPicks(filter, undefined, token) : [] },
			{ label: localize('searchEverywhereActions', "Actions"), items: [], load: () => this.commands.getPicks(filter, disposables, token) }
		];
		let pending = groups.length;
		const publish = () => {
			if (token.isCancellationRequested) {
				return;
			}
			const items: SearchPick[] = groups.flatMap(group => group.items.length ? [{ type: 'separator', label: group.label } satisfies IQuickPickSeparator, ...group.items] : []);
			if (!items.length && !pending) {
				items.push({ label: localize('noSearchEverywhereResults', "No matching files, symbols, or actions") });
			}
			update(items, pending > 0);
		};
		const itemsOf = (picks: Picks<IPickerQuickAccessItem>): readonly SearchPick[] => hasKey(picks, { items: true }) ? picks.items : picks;
		publish();
		await Promise.all(groups.map(async group => {
			try {
				const result = await group.load();
				if (hasKey(result, { additionalPicks: true })) {
					group.items = itemsOf(result.picks);
					publish();
					group.items = [...group.items, ...itemsOf(await result.additionalPicks)];
				} else {
					group.items = itemsOf(result);
				}
			} catch {
				// One unavailable source must not hide results from the other providers.
			} finally {
				pending--;
				publish();
			}
		}));
	}
}

export class IntelliJSearchEverywhereAction extends Action2 {
	static readonly ID = 'workbench.action.intellijSearchEverywhere';

	constructor() {
		super({ id: IntelliJSearchEverywhereAction.ID, title: localize2('intellijSearchEverywhere', "Search Everywhere"), f1: true });
	}

	override run(accessor: ServicesAccessor): void {
		accessor.get(IQuickInputService).quickAccess.show(IntelliJQuickAccessProvider.PREFIX);
	}
}
