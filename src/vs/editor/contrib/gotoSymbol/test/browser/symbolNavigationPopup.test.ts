/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverDelegate, IHoverDelegateOptions } from '../../../../../base/browser/ui/hover/hoverDelegate.js';
import { IManagedHoverContentOrFactory } from '../../../../../base/browser/ui/hover/hover.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewDelegate, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService, toWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { EditorOption } from '../../../../common/config/editorOptions.js';
import { Range } from '../../../../common/core/range.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../common/services/resolverService.js';
import { ILanguageFeaturesService } from '../../../../common/services/languageFeatures.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { withAsyncTestCodeEditor, ITestCodeEditor } from '../../../../test/browser/testCodeEditor.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { OneReference, ReferencesModel } from '../../browser/referencesModel.js';
import { popupPlacement, SymbolNavigationPopup, usageSnippet } from '../../browser/intellij/symbolNavigationPopup.js';

suite('IntelliJ Symbol Navigation Popup', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const api = URI.file('/project/Api.java');
	const handler = URI.file('/project/controller/Handler.java');

	function references() {
		return store.add(new ReferencesModel([
			{ uri: api, range: new Range(1, 6, 1, 9) },
			{ uri: handler, range: new Range(1, 11, 1, 14) },
			{ uri: handler, range: new Range(2, 11, 2, 14) }
		], 'References'));
	}

	function createPopup(editor: ITestCodeEditor, instantiationService: TestInstantiationService, token = CancellationToken.None, model = references()) {
		const host = dom.append(document.body, dom.$('div'));
		const editorNode = dom.append(document.body, dom.$('div'));
		editorNode.classList.add('monaco-workbench');
		editorNode.style.cssText = 'position: fixed; top: 0; left: 0; width: 1000px; height: 700px; font-family: Arial; font-size: 13px;';
		const getDomNode = editor.getDomNode;
		editor.getDomNode = () => editorNode;
		store.add(toDisposable(() => { editor.getDomNode = getDomNode; editorNode.remove(); }));
		store.add(toDisposable(() => host.remove()));
		let viewDelegate: IContextViewDelegate;
		instantiationService.stub(IContextViewService, {}, 'showContextView', (delegate: IContextViewDelegate) => {
			viewDelegate = delegate;
			const rendered = delegate.render(host);
			delegate.focus?.();
			return { close: () => { rendered.dispose(); host.replaceChildren(); delegate.onHide?.(); } };
		});
		instantiationService.stub(IContextViewService, {}, 'layout', () => { });
		const hovers = new Map<HTMLElement, IManagedHoverContentOrFactory>();
		const hoverDelegates = new Map<HTMLElement, IHoverDelegate>();
		instantiationService.stub(IHoverService, {}, 'setupManagedHover', (delegate: IHoverDelegate, target: HTMLElement, content: IManagedHoverContentOrFactory) => {
			hovers.set(target, content);
			hoverDelegates.set(target, delegate);
			return { dispose: () => { hovers.delete(target); hoverDelegates.delete(target); }, show: () => { }, hide: () => { }, update: () => { } };
		});
		instantiationService.stub(ILabelService, {}, 'getUriLabel', (uri: URI) => uri.path);
		instantiationService.stub(IWorkspaceContextService, {}, 'getWorkspaceFolder', (uri: URI) => uri.scheme === 'file' && uri.path.startsWith('/project/') ? toWorkspaceFolder(URI.file('/project')) : null);
		instantiationService.stub(ITextModelService, {}, 'createModelReference', async () => {
			const textEditorModel = createTextModel('  service.run();\n  service.run();');
			return { object: { textEditorModel }, dispose: () => textEditorModel.dispose() };
		});
		const popup = store.add(instantiationService.createInstance(SymbolNavigationPopup, editor, model, token, true));
		return { popup, host, hovers, hoverDelegates, anchor: () => viewDelegate.getAnchor() };
	}

	function key(element: HTMLElement, value: string, code: number) {
		element.dispatchEvent(new KeyboardEvent('keydown', { key: value, keyCode: code, bubbles: true, cancelable: true }));
	}

	test('places the popup within the editor and flips above a low symbol', () => {
		const bounds = { left: 200, top: 80, width: 1000, height: 700 };
		assert.deepStrictEqual(popupPlacement(bounds, { left: 950, top: 550, height: 20 }, 800, 300), { x: 392, y: 322 });
		assert.deepStrictEqual(popupPlacement(bounds, { left: 10, top: 20, height: 20 }, 800, 300), { x: 208, y: 128 });
		const crowded = popupPlacement(bounds, { left: 950, top: 300, height: 20 }, 984, 684);
		assert.deepStrictEqual(crowded, { x: 208, y: 88 });
	});

	test('popup and column widths resize with the keyboard and reset independently', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			const root = host.querySelector<HTMLElement>('.intellij-symbol-popup')!;
			const handles = host.querySelectorAll<HTMLElement>('[role="separator"]');
			const before = root.querySelector<HTMLElement>('.intellij-symbol-popup-file-heading')!.style.width;
			key(handles[0], 'ArrowRight', 39);
			assert.notStrictEqual(root.querySelector<HTMLElement>('.intellij-symbol-popup-file-heading')!.style.width, before);
			handles[0].dispatchEvent(new MouseEvent('dblclick'));
			assert.strictEqual(root.querySelector<HTMLElement>('.intellij-symbol-popup-file-heading')!.style.width, before);
			assert.strictEqual(handles[1].getAttribute('aria-orientation'), 'vertical');
			const grip = host.querySelector<HTMLElement>('.intellij-symbol-popup-resize')!;
			assert.ok(grip.getAttribute('aria-label')?.includes('arrow keys'));
			const originalWidth = root.offsetWidth;
			const originalHeight = root.offsetHeight;
			key(grip, 'ArrowRight', 39);
			key(grip, 'ArrowDown', 40);
			assert.strictEqual(root.offsetWidth, originalWidth + 10);
			assert.strictEqual(root.offsetHeight, originalHeight + 10);
			// Synthetic events have no active pointer in Chromium, so emulate only capture.
			grip.setPointerCapture = () => { };
			grip.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
			grip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 115, bubbles: true }));
			grip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
			assert.strictEqual(root.offsetWidth, originalWidth + 30);
			assert.strictEqual(root.offsetHeight, originalHeight + 25);
			grip.dispatchEvent(new MouseEvent('dblclick'));
			assert.strictEqual(root.offsetWidth, originalWidth);
			assert.strictEqual(root.offsetHeight, originalHeight);
			key(grip, 'Escape', 27);
			assert.strictEqual(await result, undefined);
		});
	});

	test('uses heading-only icons, aligned columns, native UI fonts and editor code fonts, with source hover context', async () => {
		await withAsyncTestCodeEditor('void run() {}', { fontSize: 18, fontFamily: 'monospace', letterSpacing: 2, fontLigatures: true }, async (editor, _view, instantiationService) => {
			const { popup, host, hovers, hoverDelegates } = createPopup(editor, instantiationService);
			const result = popup.show();
			await timeout(0);
			const root = host.querySelector<HTMLElement>('.intellij-symbol-popup')!;
			root.style.setProperty('--vscode-editorWidget-foreground', '#ddd');
			root.style.setProperty('--vscode-editorWidget-background', '#26282c');
			root.style.setProperty('--vscode-editorGroupHeader-tabsBackground', '#181818');
			assert.strictEqual(dom.getWindow(root).getComputedStyle(host.querySelector<HTMLElement>('.intellij-symbol-popup-header')!).backgroundColor, 'rgb(38, 40, 44)');
			root.style.setProperty('--vscode-editor-background', '#191a1c');
			root.style.setProperty('--vscode-spacing-size120', '12px');
			root.style.setProperty('--vscode-strokeThickness', '1px');
			root.style.setProperty('--vscode-editorWidget-border', '#ff00ff');
			assert.strictEqual(root.style.fontSize, '13px');
			assert.strictEqual(root.style.fontFamily, 'Arial');
			const leaf = host.querySelector<HTMLElement>('.intellij-symbol-popup-row:not(.intellij-symbol-popup-file-group)')!;
			assert.strictEqual(leaf.querySelector<HTMLElement>('.intellij-symbol-popup-icon')!.hidden, true);
			assert.strictEqual(host.querySelector<HTMLElement>('.intellij-symbol-popup-file-group .intellij-symbol-popup-icon')!.hidden, false);
			const header = host.querySelector<HTMLElement>('.intellij-symbol-popup-columns')!;
			const sourceHeading = host.querySelector<HTMLElement>('.intellij-symbol-popup-source-heading')!;
			const sourceCell = leaf.querySelector<HTMLElement>('.intellij-symbol-popup-source-cell')!;
			assert.ok(Math.abs(sourceHeading.getBoundingClientRect().left - sourceCell.getBoundingClientRect().left) < 1);
			assert.notStrictEqual(dom.getWindow(root).getComputedStyle(header).backgroundColor, dom.getWindow(root).getComputedStyle(root).backgroundColor);
			assert.strictEqual(dom.getWindow(root).getComputedStyle(leaf.querySelector<HTMLElement>('.intellij-symbol-popup-code')!).fontSize, `${editor.getOption(EditorOption.fontInfo).fontSize}px`);
			const snippetStyle = leaf.querySelector<HTMLElement>('.intellij-symbol-popup-code')!.style;
			assert.strictEqual(snippetStyle.letterSpacing, '');
			assert.strictEqual(snippetStyle.fontFeatureSettings, '');
			assert.strictEqual(snippetStyle.lineHeight, '');
			root.style.setProperty('--vscode-list-activeSelectionBackground', '#005500');
			root.style.setProperty('--vscode-list-focusAndSelectionOutline', '#ff00ff');
			const list = host.querySelector<HTMLElement>('.monaco-list')!;
			const listRow = leaf.closest<HTMLElement>('.monaco-list-row')!;
			list.focus();
			assert.notStrictEqual(dom.getWindow(root).getComputedStyle(listRow).backgroundColor, 'rgb(0, 85, 0)');
			assert.notStrictEqual(dom.getWindow(root).getComputedStyle(listRow).outlineColor, 'rgb(255, 0, 255)');
			host.querySelector<HTMLInputElement>('input')!.focus();
			const group = host.querySelector<HTMLElement>('.intellij-symbol-popup-file-group')!;
			assert.strictEqual(dom.getWindow(root).getComputedStyle(group).borderTopWidth, '1px');
			assert.notStrictEqual(dom.getWindow(root).getComputedStyle(group).borderTopColor, 'rgb(255, 0, 255)');
			assert.strictEqual(dom.getWindow(root).getComputedStyle(group).backgroundColor, 'rgba(0, 0, 0, 0)');
			assert.strictEqual(dom.getWindow(root).getComputedStyle(leaf).backgroundColor, 'rgb(25, 26, 28)');
			assert.strictEqual(dom.getWindow(root).getComputedStyle(leaf.closest<HTMLElement>('.monaco-list-row')!).backgroundColor, 'rgba(0, 0, 0, 0)');
			const badge = group.querySelector<HTMLElement>('.intellij-symbol-popup-line')!;
			assert.ok(badge.offsetHeight < group.offsetHeight);
			const hover = hovers.get(leaf)!;
			assert.strictEqual(typeof hover, 'function');
			const preview = (hover as () => HTMLElement)();
			assert.strictEqual(preview.querySelectorAll('pre > div').length, 2);
			assert.strictEqual(preview.querySelector('.intellij-symbol-popup-preview-title')?.textContent, '/project/Api.java:1');
			assert.ok(preview.querySelector('.match')!.textContent?.includes('service.run();'));
			const nativeDelegate = getDefaultHoverDelegate('element');
			const originalShow = nativeDelegate.showHover;
			let hoverOptions: IHoverDelegateOptions | undefined;
			nativeDelegate.showHover = options => { hoverOptions = options; return undefined; };
			try {
				hoverDelegates.get(leaf)!.showHover({ target: leaf, content: preview });
				assert.strictEqual(hoverOptions?.container, root.parentElement);
			} finally {
				nativeDelegate.showHover = originalShow;
			}
			key(host.querySelector<HTMLInputElement>('input')!, 'Escape', 27);
			await result;
			assert.strictEqual(hovers.size, 0);
		});
	});

	test('keeps Islands popup surfaces under Dark Modern without recoloring the editor or light themes', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const { popup, host, hovers } = createPopup(editor, instantiationService);
			host.classList.add('vs-dark');
			host.style.setProperty('--vscode-editorWidget-background', '#202020');
			host.style.setProperty('--vscode-editor-background', '#1f1f1f');
			host.style.setProperty('--vscode-input-background', '#313131');
			const result = popup.show();
			await timeout(0);
			const color = (selector: string) => dom.getWindow(host).getComputedStyle(host.querySelector<HTMLElement>(selector)!).backgroundColor;
			assert.strictEqual(color('.intellij-symbol-popup'), 'rgb(38, 40, 44)');
			assert.strictEqual(color('.intellij-symbol-popup-header'), 'rgb(38, 40, 44)');
			assert.strictEqual(color('.intellij-symbol-popup-filter'), 'rgb(33, 35, 38)');
			assert.strictEqual(color('.intellij-symbol-popup-columns'), 'rgb(25, 26, 28)');
			const leaf = host.querySelector<HTMLElement>('.intellij-symbol-popup-row:not(.intellij-symbol-popup-file-group)')!;
			assert.strictEqual(dom.getWindow(host).getComputedStyle(leaf).backgroundColor, 'rgb(25, 26, 28)');
			assert.strictEqual(host.style.getPropertyValue('--vscode-editor-background'), '#1f1f1f');
			const preview = (hovers.get(leaf) as () => HTMLElement)();
			host.appendChild(preview);
			assert.strictEqual(color('.intellij-symbol-popup-preview'), 'rgb(38, 40, 44)');
			preview.remove();
			host.classList.remove('vs-dark');
			assert.strictEqual(color('.intellij-symbol-popup'), 'rgb(32, 32, 32)');
			key(host.querySelector<HTMLInputElement>('input')!, 'Escape', 27);
			await result;
		});
	});

	test('keeps its anchor fixed when every section is collapsed and expanded', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const { popup, host, anchor } = createPopup(editor, instantiationService);
			const originalCaret = editor.getScrolledVisiblePosition;
			editor.getScrolledVisiblePosition = () => ({ left: 500, top: 400, height: 20 });
			store.add(toDisposable(() => { editor.getScrolledVisiblePosition = originalCaret; }));
			const result = popup.show();
			await timeout(0);
			const before = anchor();
			const groups = [...host.querySelectorAll('.intellij-symbol-popup-file-group')];
			for (const group of groups) {
				group.closest<HTMLElement>('.monaco-list-row')!.click();
				assert.deepStrictEqual(anchor(), before);
			}
			for (const group of groups) {
				group.closest<HTMLElement>('.monaco-list-row')!.click();
				assert.deepStrictEqual(anchor(), before);
			}
			key(host.querySelector<HTMLInputElement>('input')!, 'Escape', 27);
			await result;
		});
	});

	test('keeps the first category fully visible on opening and after delayed classification', async () => {
		const source = store.add(createTextModel('void run() {}', undefined, undefined, api));
		await withAsyncTestCodeEditor(source, {}, async (editor, _view, instantiationService) => {
			const pending = new DeferredPromise<void>();
			const features = instantiationService.get(ILanguageFeaturesService);
			store.add(features.definitionProvider.register('*', { provideDefinition: async () => {
				await pending.p;
				return { uri: api, range: new Range(1, 6, 1, 9) };
			} }));
			store.add(features.implementationProvider.register('*', { provideImplementation: () => ({ uri: handler, range: new Range(1, 11, 1, 14) }) }));
			const model = store.add(new ReferencesModel([
				{ uri: api, range: new Range(1, 6, 1, 9) },
				...Array.from({ length: 20 }, (_, index) => ({ uri: handler, range: new Range(index + 1, 11, index + 1, 14) }))
			], 'References'));
			const { popup, host } = createPopup(editor, instantiationService, CancellationToken.None, model);
			const result = popup.show();
			const viewport = host.querySelector<HTMLElement>('.intellij-symbol-popup-list')!;
			const firstHeading = () => host.querySelector<HTMLElement>('.intellij-symbol-popup-file-group')!;
			await timeout(0);
			assert.ok(Math.abs(firstHeading().getBoundingClientRect().top - viewport.getBoundingClientRect().top) < 1);
			await pending.complete();
			await timeout(0);
			assert.strictEqual(firstHeading().querySelector('.intellij-symbol-popup-file')?.textContent, 'Implementations');
			assert.ok(Math.abs(firstHeading().getBoundingClientRect().top - viewport.getBoundingClientRect().top) < 1);
			key(host.querySelector<HTMLInputElement>('input')!, 'Escape', 27);
			await result;
		});
	});

	test('filters by path, scopes to the current file, and reports empty results', async () => {
		const source = store.add(createTextModel('void run() {}', undefined, undefined, api));
		await withAsyncTestCodeEditor(source, {}, async (editor, _view, instantiationService) => {
			editor.setPosition({ lineNumber: 1, column: 7 });
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			const filter = host.querySelector<HTMLInputElement>('input')!;
			assert.strictEqual(host.querySelector('[role="dialog"]')?.getAttribute('aria-label'), 'Usages');
			assert.strictEqual(host.querySelector('.intellij-symbol-popup-title')?.textContent, 'Usages of run');
			filter.value = 'controller/Handler';
			filter.dispatchEvent(new Event('input'));
			assert.strictEqual(host.querySelector('[role="status"]')?.textContent, '2 of 3 references');
			host.querySelector<HTMLButtonElement>('.intellij-symbol-popup-scope')!.click();
			assert.strictEqual(host.querySelector<HTMLElement>('.intellij-symbol-popup-empty')?.hidden, false);
			key(filter, 'Escape', 27);
			assert.strictEqual(await result, undefined);
		});
	});

	test('arrow and Enter open the selected original reference', async () => {
		const source = store.add(createTextModel('void run() {}', undefined, undefined, api));
		await withAsyncTestCodeEditor(source, {}, async (editor, _view, instantiationService) => {
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			const filter = host.querySelector<HTMLInputElement>('input')!;
			filter.value = 'Handler';
			filter.dispatchEvent(new Event('input'));
			key(filter, 'ArrowDown', 40);
			const list = host.querySelector<HTMLElement>('[role="tree"]')!;
			key(list, 'ArrowDown', 40);
			key(list, 'Enter', 13);
			const selected = await result;
			assert.ok(selected instanceof OneReference);
			assert.deepStrictEqual({ uri: selected.uri, line: selected.range.startLineNumber }, { uri: handler, line: 2 });
		});
	});

	for (const includeDeclaration of [false, true]) {
		test(`adds library implementations independently of slow definitions with ${includeDeclaration ? 'one' : 'no'} reference results`, async () => {
			const library = URI.parse('jdt://contents/library.jar/pkg/Api.java?handle=Api.class');
			const implementation = URI.parse('jdt://contents/library.jar/pkg/Handler.java?handle=Handler.class');
			const range = new Range(1, 6, 1, 9);
			const declaration = { uri: library, range };
			const target = { uri: implementation, range };
			const source = store.add(createTextModel('void run();', undefined, undefined, library));
			await withAsyncTestCodeEditor(source, { readOnly: true }, async (editor, _view, instantiationService) => {
				editor.setPosition({ lineNumber: 1, column: 7 });
				const pending = new DeferredPromise<void>();
				const features = instantiationService.get(ILanguageFeaturesService);
				store.add(features.definitionProvider.register('*', { provideDefinition: async () => { await pending.p; return declaration; } }));
				store.add(features.implementationProvider.register('*', { provideImplementation: () => [target, target] }));
				const model = store.add(new ReferencesModel(includeDeclaration ? [declaration] : [], 'References'));
				const { popup, host } = createPopup(editor, instantiationService, CancellationToken.None, model);
				const result = popup.show();
				await timeout(0);
				assert.deepStrictEqual({
					heading: host.querySelector('.intellij-symbol-popup-file-group .intellij-symbol-popup-file')?.textContent,
					busy: host.querySelector('[role="dialog"]')?.getAttribute('aria-busy')
				}, { heading: 'Implementations', busy: 'true' });
				await pending.complete();
				await timeout(0);
				host.querySelector<HTMLButtonElement>('.intellij-symbol-popup-expand')!.click();
				assert.deepStrictEqual(await result, { references: includeDeclaration ? [declaration, target] : [target, declaration] });
			});
		});
	}

	test('distinguishes same-named workspace and library sources and filters by origin', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const model = store.add(new ReferencesModel([
				{ uri: URI.file('/project/src/Service.java'), range: new Range(1, 1, 1, 5) },
				{ uri: URI.parse('jdt://contents/legal-compliance-rules-lib-3.4.38.jar/com.example/Service.java?handle'), range: new Range(1, 1, 1, 5) }
			], 'References'));
			const { popup, host } = createPopup(editor, instantiationService, CancellationToken.None, model);
			const result = popup.show();
			await timeout(0);
			const rows = () => [...host.querySelectorAll('.intellij-symbol-popup-row:not(.intellij-symbol-popup-file-group)')].map(row => ({
				file: row.querySelector('.intellij-symbol-popup-file')?.textContent,
				origin: row.querySelector('.intellij-symbol-popup-origin'),
				path: row.querySelector('.intellij-symbol-popup-path')?.textContent
			}));
			assert.deepStrictEqual(rows(), [
				{ file: 'Service.java', origin: null, path: '/project/src/Service.java' },
				{ file: 'Service.java', origin: null, path: '/legal-compliance-rules-lib-3.4.38.jar/com.example/Service.java' }
			]);
			const filter = host.querySelector<HTMLInputElement>('input')!;
			filter.value = 'Library';
			filter.dispatchEvent(new Event('input'));
			assert.strictEqual(rows().length, 1);
			assert.ok(rows()[0].path?.includes('legal-compliance-rules-lib-3.4.38.jar'));
			key(filter, 'Escape', 27);
			await result;
		});
	});

	test('can transfer the result model to the full results view', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			host.querySelector<HTMLButtonElement>('.intellij-symbol-popup-expand')!.click();
			assert.deepStrictEqual(await result, { references: references().references.map(reference => reference.link) });
		});
	});

	test('shows semantic category counts, collapses with the keyboard, and preserves filtering when grouping is disabled', async () => {
		const source = store.add(createTextModel('void run() {}', undefined, undefined, api));
		await withAsyncTestCodeEditor(source, {}, async (editor, _view, instantiationService) => {
			const features = instantiationService.get(ILanguageFeaturesService);
			store.add(features.definitionProvider.register('*', { provideDefinition: () => ({ uri: api, range: new Range(1, 6, 1, 9) }) }));
			store.add(features.implementationProvider.register('*', { provideImplementation: () => ({ uri: handler, range: new Range(1, 11, 1, 14) }) }));
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			await timeout(0);
			const groups = [...host.querySelectorAll('.intellij-symbol-popup-file-group')].map(group => ({
				label: group.querySelector('.intellij-symbol-popup-file')?.textContent,
				count: group.querySelector('.intellij-symbol-popup-line')?.textContent
			}));
			assert.deepStrictEqual(groups, [{ label: 'Implementations', count: '1' }, { label: 'Production Usages', count: '1' }, { label: 'Declarations', count: '1' }]);
			const icons = [...host.querySelectorAll('.intellij-symbol-popup-file-group .intellij-symbol-popup-icon')].map(icon => icon.className);
			assert.strictEqual(new Set(icons).size, 3);
			const viewport = host.querySelector<HTMLElement>('.intellij-symbol-popup-list')!;
			const expandedHeight = viewport.offsetHeight;
			const tree = host.querySelector<HTMLElement>('[role="tree"]')!;
			host.querySelector('.intellij-symbol-popup-file-group')!.closest<HTMLElement>('.monaco-list-row')!.click();
			assert.strictEqual(host.querySelector('[role="treeitem"]')?.getAttribute('aria-expanded'), 'false');
			assert.strictEqual(viewport.offsetHeight, expandedHeight - 32);
			tree.focus();
			key(tree, 'Enter', 13);
			assert.strictEqual(viewport.offsetHeight, expandedHeight);
			assert.strictEqual(host.querySelector('[role="treeitem"]')?.getAttribute('aria-expanded'), 'true');
			const filter = host.querySelector<HTMLInputElement>('input')!;
			filter.value = 'Handler';
			filter.dispatchEvent(new Event('input'));
			host.querySelector<HTMLButtonElement>('.intellij-symbol-popup-grouping')!.click();
			assert.deepStrictEqual({ groups: host.querySelectorAll('.intellij-symbol-popup-file-group').length, count: host.querySelector('[role="status"]')?.textContent }, {
				groups: 0, count: '2 of 3 references'
			});
			key(filter, 'Escape', 27);
			assert.strictEqual(await result, undefined);
		});
	});

	test('cancellation dismisses the popup and releases previews that resolve after it closes', async () => {
		await withAsyncTestCodeEditor('void run() {}', {}, async (editor, _view, instantiationService) => {
			const cts = store.add(new CancellationTokenSource());
			const pending = new DeferredPromise<IReference<IResolvedTextEditorModel>>();
			const { popup, host } = createPopup(editor, instantiationService, cts.token);
			instantiationService.stub(ITextModelService, {}, 'createModelReference', () => pending.p);
			const result = popup.show();
			cts.cancel();
			assert.strictEqual(await result, undefined);
			popup.dispose();
			let released = false;
			await pending.complete({ object: new class extends mock<IResolvedTextEditorModel>() { }, dispose: () => { released = true; } });
			assert.deepStrictEqual({ released, visible: !!host.querySelector('[role="dialog"]') }, { released: true, visible: false });
		});
	});

	test('a failed implementation provider leaves unresolved references unclassified', async () => {
		const source = store.add(createTextModel('void run() {}', undefined, undefined, api));
		await withAsyncTestCodeEditor(source, {}, async (editor, _view, instantiationService) => {
			const features = instantiationService.get(ILanguageFeaturesService);
			store.add(features.definitionProvider.register('*', { provideDefinition: () => ({ uri: api, range: new Range(1, 6, 1, 9) }) }));
			store.add(features.implementationProvider.register('*', { provideImplementation: () => { throw new Error('Server unavailable'); } }));
			const { popup, host } = createPopup(editor, instantiationService);
			const result = popup.show();
			await timeout(0);
			assert.deepStrictEqual([...host.querySelectorAll('.intellij-symbol-popup-file-group .intellij-symbol-popup-file')].map(node => node.textContent), ['Declarations', 'Other References']);
			key(host.querySelector<HTMLInputElement>('input')!, 'Escape', 27);
			assert.strictEqual(await result, undefined);
		});
	});

	test('adjusts snippet highlights for indentation and multi-line ranges', () => {
		assert.deepStrictEqual([
			usageSnippet('    service.run();  ', new Range(1, 13, 1, 16)),
			usageSnippet('    run(', new Range(1, 5, 2, 8))
		], [
			{ text: 'service.run();', start: 8, end: 11 },
			{ text: 'run(', start: 0, end: 4 }
		]);
	});
});
