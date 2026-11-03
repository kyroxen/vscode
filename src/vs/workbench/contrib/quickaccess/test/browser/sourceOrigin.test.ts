/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { extUri } from '../../../../../base/common/resources.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IDecorationsProvider, IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { LabelService } from '../../../../services/label/common/labelService.js';
import { TestEditorInput, TestEnvironmentService, TestLifecycleService, TestPathService, TestRemoteAgentService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IStatusbarEntry, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { SourceOriginContribution } from '../../../intellij/browser/sourceOrigin.js';

suite('IntelliJ Source Origin', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers native library tab badges and artifact breadcrumb homes without renaming files', async () => {
		const labels = store.add(new LabelService(TestEnvironmentService, new TestContextService(), new TestPathService(URI.file('/home')), new TestRemoteAgentService(), store.add(new TestStorageService()), store.add(new TestLifecycleService()), {
			_serviceBrand: undefined, extUri, asCanonicalUri: uri => uri
		}));
		const instantiationService = store.add(new TestInstantiationService());
		let provider: IDecorationsProvider | undefined;
		let disposed = false;
		instantiationService.stub(ILabelService, labels);
		instantiationService.stub(IEditorService, { onDidActiveEditorChange: Event.None });
		instantiationService.stub(IStatusbarService, {});
		instantiationService.stub(IDecorationsService, {}, 'registerDecorationsProvider', (value: IDecorationsProvider) => {
			provider = value;
			return toDisposable(() => { disposed = true; });
		});
		const contribution = store.add(instantiationService.createInstance(SourceOriginContribution));
		const library = URI.parse('jdt://contents/legal-compliance-rules-lib-3.4.38.jar/com.example/CustomsMetadata.java?opaque');
		const jdk = URI.parse('jdt://contents/java.base/java.lang/String.class?opaque');
		assert.ok(provider);
		const libraryBadge = await provider.provideDecorations(library, CancellationToken.None);
		const jdkBadge = await provider.provideDecorations(jdk, CancellationToken.None);
		assert.deepStrictEqual({
			badge: libraryBadge?.letter,
			jdkBadge: jdkBadge?.letter,
			workspaceBadge: await provider.provideDecorations(URI.file('/project/Foo.java'), CancellationToken.None),
			label: labels.getUriLabel(library),
			home: labels.getUriHome(library)?.path,
			name: labels.getUriBasenameLabel(library),
			jdkLabel: labels.getUriLabel(jdk),
			tooltip: libraryBadge?.tooltip
		}, {
			badge: '[Library]', jdkBadge: '[JDK]', workspaceBadge: undefined,
			label: 'Library/legal-compliance-rules-lib · 3.4.38/com.example/CustomsMetadata.java',
			home: '/legal-compliance-rules-lib-3.4.38.jar', name: 'CustomsMetadata.java',
			jdkLabel: 'JDK/java.base/java.lang/String.class',
			tooltip: 'Library\nlegal-compliance-rules-lib · 3.4.38\ncom.example\n/legal-compliance-rules-lib-3.4.38.jar/com.example/CustomsMetadata.java'
		});
		contribution.dispose();
		assert.deepStrictEqual({ disposed, home: labels.getUriHome(library) }, { disposed: true, home: undefined });
	});

	test('updates the persistent source entry between library and JDK editors and clears it for workspace files', () => {
		const instantiationService = store.add(new TestInstantiationService());
		const changed = store.add(new Emitter<void>());
		let activeEditor = store.add(new TestEditorInput(URI.parse('jdt://contents/library-1.2.jar/pkg/Foo.java'), 'test'));
		const text: string[] = [];
		let released = false;
		instantiationService.stub(IEditorService, { get activeEditor() { return activeEditor; }, onDidActiveEditorChange: changed.event });
		instantiationService.stub(IDecorationsService, {}, 'registerDecorationsProvider', () => toDisposable(() => { }));
		instantiationService.stub(ILabelService, {}, 'registerFormatter', () => toDisposable(() => { }));
		instantiationService.stub(IStatusbarService, {}, 'addEntry', (entry: IStatusbarEntry) => {
			text.push(entry.text);
			return { update: (entry: IStatusbarEntry) => text.push(entry.text), dispose: () => { released = true; } };
		});
		store.add(instantiationService.createInstance(SourceOriginContribution));
		activeEditor = store.add(new TestEditorInput(URI.parse('jdt://contents/java.base/java.lang/String.class'), 'test'));
		changed.fire();
		activeEditor = store.add(new TestEditorInput(URI.file('/project/Foo.java'), 'test'));
		changed.fire();
		assert.deepStrictEqual({ text, released }, { text: ['$(package) Library · library · 1.2', '$(package) JDK · java.base'], released: true });
	});
});
