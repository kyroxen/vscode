/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { EditorOptions } from '../../../../common/config/editorOptions.js';
import { Range } from '../../../../common/core/range.js';
import { OneReference, ReferencesModel } from '../../browser/referencesModel.js';
import { shouldPickSymbolNavigation, SymbolNavigationPicker } from '../../browser/symbolNavigationPicker.js';

import { sourceOrigin } from '../../browser/intellij/sourceOrigin.js';

interface NavigationPick extends IQuickPickItem {
	reference: OneReference;
}

suite('Symbol Navigation Picker', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createModel(): ReferencesModel {
		return store.add(new ReferencesModel([{
			uri: URI.file('/project/a/Service.java'),
			range: new Range(1, 1, 20, 1),
			targetSelectionRange: new Range(3, 8, 3, 15)
		}, {
			uri: URI.parse('jdt://contents/library/Service.java'),
			range: new Range(5, 1, 30, 1),
			targetSelectionRange: new Range(7, 9, 7, 16)
		}], 'Implementations'));
	}

	function createPicker(pick: (items: NavigationPick[]) => Promise<NavigationPick | undefined>): SymbolNavigationPicker {
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IQuickInputService, {}, 'pick', pick);
		instantiationService.stub(ILabelService, {}, 'getUriLabel', (uri: URI) => uri.path);
		return instantiationService.createInstance(SymbolNavigationPicker);
	}

	test('distinguishes same-named source and dependency destinations and preserves the selected link', async () => {
		const model = createModel();
		let descriptions: string[] = [];
		const picker = createPicker(async items => {
			descriptions = items.map(item => item.description ?? '');
			return items[1];
		});
		const selected = await picker.pick(model, CancellationToken.None);
		assert.deepStrictEqual({ descriptions, link: selected?.link }, {
			descriptions: ['/project/a/Service.java:3:8', '/library/Service.java:7:9'],
			link: model.references[1].link
		});
	});

	test('dismissal leaves navigation at the original location', async () => {
		const picker = createPicker(async () => undefined);
		assert.strictEqual(await picker.pick(createModel(), CancellationToken.None), undefined);
	});

	test('ignores a selection returned after editor state cancellation', async () => {
		const cts = store.add(new CancellationTokenSource());
		const picker = createPicker(async items => {
			cts.cancel();
			return items[0];
		});
		assert.strictEqual(await picker.pick(createModel(), cts.token), undefined);
	});

	test('opens categorized usages even when the provider returns only the library declaration or no references', () => {
		assert.deepStrictEqual([
			shouldPickSymbolNavigation('pick', 0, true),
			shouldPickSymbolNavigation('pick', 1, true),
			shouldPickSymbolNavigation('pick', 1, false),
			shouldPickSymbolNavigation('pick', 2, false),
			shouldPickSymbolNavigation('peek', 1, true),
			shouldPickSymbolNavigation('goto', 2, true)
		], [true, true, false, true, false, false]);
	});

	test('identifies library versions, JDK modules, workspace and external files without guessing decompilation', () => {
		const cases = [
			{ uri: 'jdt://contents/legal-compliance-rules-lib-3.4.38.jar/com.example/Service.java?opaque', workspace: false },
			{ uri: 'jdt://contents/jackson-databind-2.17.0-SNAPSHOT.jar/com.fasterxml/Foo.class', workspace: false },
			{ uri: 'jdt://contents/custom-library.jar/com.example/Service.java', workspace: false },
			{ uri: 'jdt://contents/java.base/java.lang/String.class', workspace: false },
			{ uri: 'jrt:/java.base/java/lang/String.class', workspace: false },
			{ uri: 'jdt://contents/rt.jar/java.lang/String.class', workspace: false },
			{ uri: 'vscode-remote://ssh-remote+host/project/Service.java', workspace: true },
			{ uri: 'file:///outside/Service.java', workspace: false },
			{ uri: 'custom:/generated/Service.java', workspace: false }
		];
		assert.deepStrictEqual(cases.map(item => {
			const origin = sourceOrigin(URI.parse(item.uri), item.workspace);
			return [origin.kind, origin.label, origin.detail, origin.packageName];
		}), [
			['library', 'Library', 'legal-compliance-rules-lib · 3.4.38', 'com.example'],
			['library', 'Library', 'jackson-databind · 2.17.0-SNAPSHOT', 'com.fasterxml'],
			['library', 'Library', 'custom-library', 'com.example'],
			['jdk', 'JDK', 'java.base', 'java.lang'],
			['jdk', 'JDK', 'java.base', 'java.lang'],
			['jdk', 'JDK', 'rt.jar', 'java.lang'],
			['workspace', 'Workspace', undefined, undefined],
			['file', 'File', undefined, undefined],
			['external', 'External', undefined, undefined]
		]);
	});

	test('accepts pick for navigation preferences without changing defaults', () => {
		const options = EditorOptions.gotoLocation;
		const configured = options.validate({ multipleDefinitions: 'pick', multipleImplementations: 'pick' });
		assert.deepStrictEqual({ definitions: configured.multipleDefinitions, implementations: configured.multipleImplementations, references: configured.multipleReferences }, {
			definitions: 'pick', implementations: 'pick', references: 'peek'
		});
	});

	test('identifies nested, scoped, remote, and pnpm npm dependencies ahead of workspace membership', () => {
		const cases = [
			'file:///repo/node_modules/react/index.js',
			'file:///repo/node_modules/@types/react/index.d.ts',
			'file:///repo/node_modules/outer/node_modules/inner/index.js',
			'file:///repo/node_modules/.pnpm/react@19.1.0/node_modules/react/index.js',
			'vscode-remote://ssh-remote+host/repo/node_modules/.pnpm/@scope+lib@2.0.0_react@19/node_modules/@scope/lib/index.d.ts',
			'file:///repo/packages/app/src/index.ts'
		];
		assert.deepStrictEqual(cases.map(uri => {
			const origin = sourceOrigin(URI.parse(uri), true);
			return [origin.kind, origin.detail, origin.packageName];
		}), [
			['library', 'react', 'react'],
			['library', '@types/react', '@types/react'],
			['library', 'inner', 'inner'],
			['library', 'react · 19.1.0', 'react'],
			['library', '@scope/lib · 2.0.0', '@scope/lib'],
			['workspace', undefined, undefined]
		]);
	});
});
