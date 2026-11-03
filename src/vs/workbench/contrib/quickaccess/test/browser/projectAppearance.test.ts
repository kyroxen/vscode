/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { match } from '../../../../../base/common/glob.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Configuration, ConfigurationModel } from '../../../../../platform/configuration/common/configurationModels.js';
import { Extensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService, IWorkspaceFoldersChangeEvent } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../../services/search/common/search.js';
import { IWorkbenchColorTheme, IWorkbenchFileIconTheme, IWorkbenchThemeService } from '../../../../services/themes/common/workbenchThemeService.js';
import { ProjectAppearanceContribution } from '../../../intellij/browser/projectAppearance.js';

suite('IntelliJ project appearance', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	const java = { 'workbench.colorTheme': 'IntelliJ Islands Dark', 'workbench.iconTheme': 'vsc-jetbrains-icons-enhanced' };
	const appearance = () => registry.getRegisteredDefaultConfigurations().find(entry => typeof entry.source === 'object' && entry.source.id === ProjectAppearanceContribution.ID)?.overrides;

	function fixture(files: string[] = []) {
		const instantiation = store.add(new TestInstantiationService());
		const changes = store.add(new Emitter<FileChangesEvent>());
		const folderChanges = store.add(new Emitter<IWorkspaceFoldersChangeEvent>());
		const configuration = new TestConfigurationService({ 'intellij.projectAppearance.enabled': true });
		const folders = [URI.file('/workspace'), URI.parse('vscode-remote://ssh-remote+host/other')];
		const state = { files, folders, icons: true, colors: true, searches: 0 };
		const queries: IFileQuery[] = [];
		const tokens: CancellationToken[] = [];
		const search = async (query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> => {
			queries.push(query);
			tokens.push(token ?? CancellationToken.None);
			state.searches++;
			return { results: [], messages: [], limitHit: state.files.some(file => match(query.includePattern ?? {}, file) && !match(query.excludePattern ?? {}, file)) };
		};
		instantiation.stub(IWorkspaceContextService, {
			getWorkspace: () => testWorkspace(...state.folders),
			onDidChangeWorkspaceFolders: folderChanges.event
		});
		instantiation.stub(IConfigurationService, configuration);
		instantiation.stub(ISearchService, { fileSearch: search });
		instantiation.stub(IFileService, { onDidFilesChange: changes.event });
		instantiation.stub(IWorkbenchThemeService, {
			getColorThemes: async () => state.colors ? [new class extends mock<IWorkbenchColorTheme>() { override settingsId = java['workbench.colorTheme']; }] : [],
			getFileIconThemes: async () => state.icons ? [new class extends mock<IWorkbenchFileIconTheme>() { override settingsId = java['workbench.iconTheme']; }] : []
		});
		instantiation.stub(IExtensionService, { whenInstalledExtensionsRegistered: async () => true, onDidChangeExtensions: Event.None });
		instantiation.stub(ILogService, new NullLogService());
		const contribution = store.add(instantiation.createInstance(ProjectAppearanceContribution));
		return { contribution, configuration, changes, folderChanges, instantiation, state, queries, tokens };
	}

	for (const marker of ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'Main.java', 'src/Main.java', 'modules/api/src/main/java/Main.java', 'packages/backend/pom.xml']) {
		test(`detects Java from ${marker}`, async () => {
			const { contribution, queries } = fixture(['package.json', marker]);
			await contribution.refresh();
			assert.deepStrictEqual({ appearance: appearance(), folders: queries[0].folderQueries.map(folder => folder.folder.scheme) }, {
				appearance: java, folders: ['file', 'vscode-remote']
			});
		});
	}

	test('JS/TS, unknown, dependencies and generated sources retain general defaults', async () => {
		const { contribution } = fixture(['package.json', 'tsconfig.json', 'apps/web/jsconfig.json', 'src/main.ts', 'node_modules/lib/Example.java', 'target/generated/Example.java', 'build/Example.java', '.git/pom.xml', 'packages/api/out/Example.java', 'extensions/vscode-colorize-tests/test/colorize-fixtures/basic.java', 'extensions/copilot/src/platform/parser/test/node/fixtures/test.java']);
		await contribution.refresh();
		assert.strictEqual(appearance(), undefined);
	});

	test('missing themes fall back independently, and available themes can be reconsidered', async () => {
		const { contribution, state } = fixture(['pom.xml']);
		state.icons = false;
		await contribution.refresh();
		assert.deepStrictEqual(appearance(), { 'workbench.colorTheme': java['workbench.colorTheme'] });
		state.colors = false;
		state.icons = true;
		await contribution.refresh();
		assert.deepStrictEqual(appearance(), { 'workbench.iconTheme': java['workbench.iconTheme'] });
	});

	test('opt-out and empty workspaces remove only owned defaults without searching', async () => {
		const { contribution, configuration, state } = fixture(['pom.xml']);
		await contribution.refresh();
		const searches = state.searches;
		await configuration.setUserConfiguration('intellij.projectAppearance.enabled', false);
		await contribution.refresh();
		assert.deepStrictEqual({ appearance: appearance(), searches: state.searches }, { appearance: undefined, searches });
		await configuration.setUserConfiguration('intellij.projectAppearance.enabled', true);
		state.folders.length = 0;
		await contribution.refresh();
		assert.deepStrictEqual({ appearance: appearance(), searches: state.searches }, { appearance: undefined, searches });
	});

	test('native configuration keeps explicit user and workspace selections above detected defaults', async () => {
		const { contribution } = fixture(['pom.xml']);
		await contribution.refresh();
		const log = new NullLogService();
		const model = (values: Record<string, unknown> = {}) => {
			const result = ConfigurationModel.createEmptyModel(log);
			for (const [key, value] of Object.entries(values)) {
				result.setValue(key, value);
			}
			return result;
		};
		const configuration = new Configuration(model(appearance()), model(), model(), model({ 'workbench.colorTheme': 'My Theme' }), model(), model({ 'workbench.iconTheme': 'my-icons' }), new ResourceMap(), model(), new ResourceMap(), log);
		assert.deepStrictEqual([configuration.getValue('workbench.colorTheme', {}, undefined), configuration.getValue('workbench.iconTheme', {}, undefined)], ['My Theme', 'my-icons']);
		contribution.dispose();
		assert.strictEqual(appearance(), undefined);
	});

	test('file additions and removals recompute the window appearance', async () => {
		const { contribution, state, changes } = fixture();
		await contribution.refresh();
		state.files.push('modules/backend/pom.xml');
		changes.fire(new FileChangesEvent([{ resource: URI.file('/workspace/modules/backend'), type: FileChangeType.ADDED }], false));
		await timeout(250);
		assert.deepStrictEqual(appearance(), java);
		state.files.length = 0;
		changes.fire(new FileChangesEvent([{ resource: URI.file('/workspace/modules/backend'), type: FileChangeType.DELETED }], false));
		await timeout(250);
		assert.strictEqual(appearance(), undefined);
	});

	test('workspace-folder changes reclassify, and unchanged results do not republish defaults', async () => {
		const { contribution, state, folderChanges } = fixture(['pom.xml']);
		await contribution.refresh();
		let updates = 0;
		store.add(registry.onDidUpdateConfiguration(() => updates++));
		await contribution.refresh();
		assert.strictEqual(updates, 0);
		state.folders.length = 0;
		folderChanges.fire({ added: [], removed: [], changed: [] });
		await timeout(250);
		assert.deepStrictEqual({ appearance: appearance(), updates }, { appearance: undefined, updates: 1 });
	});

	test('cancelled and disposed detection cannot publish stale defaults', async () => {
		const { contribution, instantiation, state } = fixture();
		await contribution.refresh();
		const pending = new DeferredPromise<ISearchComplete>();
		let token = CancellationToken.None;
		instantiation.stub(ISearchService, 'fileSearch', async (_query: IFileQuery, cancellation?: CancellationToken) => {
			token = cancellation ?? CancellationToken.None;
			return pending.p;
		});
		const stale = contribution.refresh();
		await timeout(0);
		state.folders.length = 0;
		await contribution.refresh();
		assert.strictEqual(token.isCancellationRequested, true);
		await pending.complete({ results: [], limitHit: true, messages: [] });
		await stale;
		assert.strictEqual(appearance(), undefined);
		const disposedSearch = new DeferredPromise<ISearchComplete>();
		state.folders.push(URI.file('/workspace'));
		instantiation.stub(ISearchService, 'fileSearch', async () => disposedSearch.p);
		const disposedRefresh = contribution.refresh();
		await timeout(0);
		contribution.dispose();
		await disposedSearch.complete({ results: [], limitHit: true, messages: [] });
		await disposedRefresh;
		await contribution.refresh();
		assert.strictEqual(appearance(), undefined);
	});
});
