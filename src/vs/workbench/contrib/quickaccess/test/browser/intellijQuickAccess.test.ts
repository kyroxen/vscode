/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SymbolKind } from '../../../../../editor/common/languages.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { CommandsHistory, ICommandQuickPick } from '../../../../../platform/quickinput/browser/commandsQuickAccess.js';
import { FastAndSlowPicks, IPickerQuickAccessItem } from '../../../../../platform/quickinput/browser/pickerQuickAccess.js';
import { IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { IAiRelatedInformationService } from '../../../../services/aiRelatedInformation/common/aiRelatedInformation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IntelliJClassQuickAccessProvider } from '../../../intellij/browser/classSearch.js';
import { IntelliJQuickAccessProvider, SearchEverywhereCommandsProvider } from '../../../intellij/browser/searchEverywhere.js';
import { IAnythingQuickPickItem, AnythingQuickAccessProvider } from '../../../search/browser/anythingQuickAccess.js';
import { ISymbolQuickPickItem, SymbolsQuickAccessProvider } from '../../../search/browser/symbolsQuickAccess.js';
import { WorkspaceSymbolProviderRegistry } from '../../../search/common/search.js';
import { IChatWidgetService } from '../../../chat/browser/chat.js';
import { IChatAgentService } from '../../../chat/common/participants/chatAgents.js';

type SearchPick = IPickerQuickAccessItem | IQuickPickSeparator;

class TestIntelliJQuickAccessProvider extends IntelliJQuickAccessProvider {
	search(filter: string, token: CancellationToken, update: (items: readonly SearchPick[], busy: boolean) => void) {
		return this.getSearchPicks(filter, this._register(new DisposableStore()), token, update);
	}
}

class TestClassQuickAccessProvider extends IntelliJClassQuickAccessProvider {
	getPicks(token: CancellationToken) {
		return this._getPicks('Runner', this._register(new DisposableStore()), token);
	}
}

class TestCommandsProvider extends SearchEverywhereCommandsProvider {
	protected override async getCommandPicks() {
		return [{ label: 'Run IntelliJ Regression', commandAlias: 'Execute Regression', commandId: 'test.intellij.regression', args: ['argument'] }];
	}
}

suite('IntelliJ Search Everywhere', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createProvider(files: () => FastAndSlowPicks<IAnythingQuickPickItem>, symbols: () => Promise<ISymbolQuickPickItem[]>, actions: ICommandQuickPick[] = [{ label: 'Run Java', commandId: 'test.runJava' }]) {
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stubInstance(AnythingQuickAccessProvider, { getSearchEverywherePicks: files, dispose: () => { } });
		instantiationService.stubInstance(SymbolsQuickAccessProvider, { getSymbolPicks: symbols, dispose: () => { } });
		instantiationService.stubInstance(SearchEverywhereCommandsProvider, { getPicks: async () => actions, dispose: () => { } });
		return store.add(instantiationService.createInstance(TestIntelliJQuickAccessProvider));
	}

	function labels(items: readonly SearchPick[]) {
		return items.filter(item => item.type !== 'separator').map(item => item.label);
	}

	test('publishes history, files, and actions while workspace symbols are still pending', async () => {
		const files = new DeferredPromise<IAnythingQuickPickItem[]>();
		const symbols = new DeferredPromise<ISymbolQuickPickItem[]>();
		const provider = createProvider(() => ({ picks: [{ label: 'Recent.java' }], additionalPicks: files.p }), () => symbols.p);
		let visible: readonly SearchPick[] = [];
		let busy = false;
		const search = provider.search('Run', CancellationToken.None, (items, loading) => { visible = items; busy = loading; });
		await timeout(0);
		assert.deepStrictEqual({ labels: labels(visible), busy }, { labels: ['Recent.java', 'Run Java'], busy: true });
		await files.complete([{ label: 'Runner.java' }]);
		await timeout(0);
		assert.deepStrictEqual({ labels: labels(visible), busy }, { labels: ['Recent.java', 'Runner.java', 'Run Java'], busy: true });
		await symbols.complete([{ label: 'Runner' }]);
		await search;
		assert.deepStrictEqual({ labels: labels(visible), busy }, { labels: ['Recent.java', 'Runner.java', 'Runner', 'Run Java'], busy: false });
	});

	test('preserves native acceptance and tolerates failed symbol searches', async () => {
		const executed: string[] = [];
		const action = { label: 'Run Java', commandId: 'test.runJava', accept: () => { executed.push('native handler'); } };
		const provider = createProvider(() => ({ picks: [], additionalPicks: Promise.resolve([{ label: 'Runner.java' }]) }), async () => { throw new Error('Language server unavailable'); }, [action]);
		let visible: readonly SearchPick[] = [];
		await provider.search('Run', CancellationToken.None, items => { visible = items; });
		const pick = visible.find(item => item === action);
		assert.strictEqual(pick, action);
		action.accept();
		assert.deepStrictEqual({ labels: labels(visible), executed }, { labels: ['Runner.java', 'Run Java'], executed: ['native handler'] });
	});

	test('ignores late source updates after cancellation', async () => {
		const symbols = new DeferredPromise<ISymbolQuickPickItem[]>();
		const provider = createProvider(() => ({ picks: [], additionalPicks: Promise.resolve([]) }), () => symbols.p);
		const cts = store.add(new CancellationTokenSource());
		let updates = 0;
		const search = provider.search('Run', cts.token, () => { updates++; });
		await timeout(0);
		cts.cancel();
		const before = updates;
		await symbols.complete([{ label: 'Late result' }]);
		await search;
		await provider.search('Run', cts.token, () => { updates++; });
		assert.strictEqual(updates, before);
	});

	function nativeServices() {
		const instantiationService = workbenchInstantiationService({ configurationService: () => new TestConfigurationService({ workbench: { editor: {}, commandPalette: { history: 50, experimental: {} } } }) }, store);
		instantiationService.stub(IChatWidgetService, {});
		return instantiationService;
	}

	test('class picks retain native lazy resolution and open the resolved location', async () => {
		const instantiationService = nativeServices();
		const unresolved = URI.file('/project/placeholder.java');
		const resolved = URI.file('/project/Runner.java');
		const range = new Range(12, 4, 12, 10);
		store.add(WorkspaceSymbolProviderRegistry.register({
			provideWorkspaceSymbols: () => [
				{ name: 'Runner', kind: SymbolKind.Class, location: { uri: unresolved, range: new Range(1, 1, 1, 1) } },
				{ name: 'RunnerMethod', kind: SymbolKind.Method, location: { uri: unresolved, range: new Range(1, 1, 1, 1) } }
			],
			resolveWorkspaceSymbol: symbol => ({ ...symbol, location: { uri: resolved, range } })
		}));
		const opened: { uri: string | undefined; line: number | undefined }[] = [];
		instantiationService.stub(IEditorService, 'openEditor', async (input: { resource?: URI; options?: { selection?: { startLineNumber: number } } }) => {
			opened.push({ uri: input.resource?.toString(), line: input.options?.selection?.startLineNumber });
		});
		const provider = store.add(instantiationService.createInstance(TestClassQuickAccessProvider));
		const picks = await provider.getPicks(CancellationToken.None);
		await picks[0].accept?.({ ctrlCmd: false, alt: false, shift: false }, { inBackground: false });
		assert.deepStrictEqual({ labels: picks.map(pick => pick.label), opened }, { labels: ['Runner'], opened: [{ uri: resolved.toString(), line: 12 }] });
	});

	test('native command picks match aliases, record history, forward arguments, and report errors', async () => {
		const instantiationService = nativeServices();
		instantiationService.stub(IPreferencesService, {});
		instantiationService.stub(IAiRelatedInformationService, {});
		instantiationService.stub(IChatAgentService, {});
		const executed: string[][] = [];
		const errors: string[] = [];
		instantiationService.stub(ICommandService, {}, 'executeCommand', async (id: string, argument: string) => { executed.push([id, argument]); throw new Error('Regression failure'); });
		instantiationService.stub(IDialogService, 'error', (message: string) => { errors.push(message); });
		const history = store.add(instantiationService.createInstance(CommandsHistory));
		const provider = store.add(instantiationService.createInstance(TestCommandsProvider));
		const result = await provider.getPicks('Execute Regression', store.add(new DisposableStore()), CancellationToken.None);
		assert.ok(Array.isArray(result));
		const picks = result.filter(pick => pick.type !== 'separator');
		await picks[0].accept?.({ ctrlCmd: false, alt: false, shift: false }, { inBackground: false });
		assert.deepStrictEqual({ labels: picks.map(pick => pick.label), executed, errors, inHistory: !!history.peek('test.intellij.regression') }, {
			labels: ['Run IntelliJ Regression'], executed: [['test.intellij.regression', 'argument']], errors: ['Command \'Run IntelliJ Regression\' resulted in an error'], inHistory: true
		});
		history.remove('test.intellij.regression');
	});
});
