/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { IconLabel } from '../../../../../base/browser/ui/iconLabel/iconLabel.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IMarkerData, IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../../platform/markers/common/markerService.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { explorerFileContribRegistry } from '../../../files/browser/explorerFileContrib.js';
import { ExplorerErrorUnderline } from '../../../intellij/browser/explorerErrorUnderline.js';
import '../../../intellij/browser/appearance.css';

suite('IntelliJ Explorer error underlines', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const file = URI.parse('vscode-remote://ssh-remote+host/project/Broken.java');
	const enabled = 'intellij.explorer.errorUnderlines.enabled';
	const marker = (severity: MarkerSeverity): IMarkerData => ({ severity, message: 'Diagnostic', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 });

	function fixture() {
		const root = append(mainWindow.document.body, $('.monaco-workbench'));
		store.add(toDisposable(() => root.remove()));
		const explorer = append(root, $('.explorer-folders-view'));
		const row = append(explorer, $('div', { role: 'treeitem', 'aria-label': 'Broken.java' }));
		const container = append(row, $('div'));
		const label = store.add(new IconLabel(container, { supportHighlights: true }));
		label.setLabel('Broken.java', undefined, { matches: [{ start: 0, end: 3 }], strikethrough: true });
		label.element.style.color = 'rgb(112, 174, 255)';
		root.style.setProperty('--vscode-editorError-foreground', '#f14c4c');
		const markers = store.add(new MarkerService());
		const configuration = new TestConfigurationService({ [enabled]: true, 'problems.visibility': true, 'problems.decorations.enabled': false });
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IMarkerService, markers);
		instantiation.stub(IConfigurationService, configuration);
		instantiation.stub(IUriIdentityService, { extUri });
		const contributions = explorerFileContribRegistry.create(instantiation, container, store.add(new DisposableStore()));
		const contribution = contributions.find(contribution => contribution instanceof ExplorerErrorUnderline);
		assert.ok(contribution);
		const hasUnderline = () => container.classList.contains('intellij-explorer-error');
		const configure = async (key: string, value: boolean) => {
			await configuration.setUserConfiguration(key, value);
			configuration.onDidChangeConfigurationEmitter.fire(new class extends mock<IConfigurationChangeEvent>() {
				override affectsConfiguration(section: string): boolean { return section === key; }
			});
		};
		contribution.setResource(file);
		return { root, row, container, label, markers, contribution, hasUnderline, configure };
	}

	test('only errors underline filenames, and fixing the last error clears the cue', async () => {
		const { markers, row, contribution, hasUnderline } = fixture();
		markers.changeOne('warnings', file, [marker(MarkerSeverity.Warning)]);
		await Promise.resolve();
		assert.strictEqual(hasUnderline(), false);
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		assert.deepStrictEqual({ underline: hasUnderline(), description: row.getAttribute('aria-description'), label: row.getAttribute('aria-label') }, {
			underline: true, description: 'Contains errors', label: 'Broken.java'
		});
		markers.remove('errors', [file]);
		await Promise.resolve();
		assert.deepStrictEqual({ underline: hasUnderline(), description: row.getAttribute('aria-description') }, { underline: false, description: null });
		// An initial render also sees diagnostics that arrived before the file became visible.
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		contribution.setResource(file);
		assert.strictEqual(hasUnderline(), true);
	});

	test('recycled rows and folders do not inherit another file\'s error', async () => {
		const { markers, row, contribution, hasUnderline } = fixture();
		row.setAttribute('aria-description', 'Existing description');
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		contribution.setResource(URI.joinPath(file, '..'));
		assert.deepStrictEqual({ underline: hasUnderline(), description: row.getAttribute('aria-description') }, { underline: false, description: 'Existing description' });
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		assert.strictEqual(hasUnderline(), false);
		contribution.setResource(file);
		contribution.setResource(undefined);
		assert.strictEqual(hasUnderline(), false);
	});

	test('opt-out and Problems visibility update existing rows without enabling warning decorations', async () => {
		const { markers, configure, hasUnderline } = fixture();
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		await configure(enabled, false);
		assert.strictEqual(hasUnderline(), false);
		await configure(enabled, true);
		assert.strictEqual(hasUnderline(), true);
		await configure('problems.visibility', false);
		assert.strictEqual(hasUnderline(), false);
		await configure('problems.visibility', true);
		assert.strictEqual(hasUnderline(), true);
	});

	test('native Git colors, strikethrough, and search highlights survive the themed wavy underline', async () => {
		const { root, container, markers } = fixture();
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		const nameContainer = container.querySelector<HTMLElement>('.monaco-icon-name-container')!;
		const name = container.querySelector<HTMLElement>('.label-name')!;
		const styles = getWindow(container).getComputedStyle(nameContainer);
		assert.deepStrictEqual({
			line: styles.textDecorationLine,
			style: styles.textDecorationStyle,
			color: styles.textDecorationColor,
			filenameColor: getWindow(container).getComputedStyle(name).color,
			strike: getWindow(container).getComputedStyle(name).textDecorationLine,
			highlights: container.querySelectorAll('.highlight').length,
			badges: container.querySelectorAll('.monaco-count-badge').length
		}, { line: 'underline', style: 'wavy', color: 'rgb(241, 76, 76)', filenameColor: 'rgb(112, 174, 255)', strike: 'line-through', highlights: 1, badges: 0 });
		root.style.setProperty('--vscode-editorError-foreground', '#ff0000');
		assert.strictEqual(getWindow(container).getComputedStyle(nameContainer).textDecorationColor, 'rgb(255, 0, 0)');
	});

	test('disposal removes visual and accessible cues and stops reacting to markers', async () => {
		const { row, markers, contribution, hasUnderline } = fixture();
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		contribution.dispose();
		markers.changeOne('errors', file, [marker(MarkerSeverity.Error)]);
		await Promise.resolve();
		assert.deepStrictEqual({ underline: hasUnderline(), description: row.getAttribute('aria-description') }, { underline: false, description: null });
	});
});
