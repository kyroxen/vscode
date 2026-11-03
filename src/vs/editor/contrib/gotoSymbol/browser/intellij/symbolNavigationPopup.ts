/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { HighlightedLabel } from '../../../../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { ObjectTree } from '../../../../../base/browser/ui/tree/objectTree.js';
import { ITreeRenderer, IObjectTreeElement } from '../../../../../base/browser/ui/tree/tree.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IReference } from '../../../../../base/common/lifecycle.js';
import { clamp } from '../../../../../base/common/numbers.js';
import { basename, isEqual } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { sourceOrigin, SourceOrigin } from './sourceOrigin.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { defaultListStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { applyFontInfo } from '../../../../browser/config/domFontInfo.js';
import { ICodeEditor } from '../../../../browser/editorBrowser.js';
import { EditorOption } from '../../../../common/config/editorOptions.js';
import { LocationLink } from '../../../../common/languages.js';
import { IRange, Range } from '../../../../common/core/range.js';
import { ILanguageFeaturesService } from '../../../../common/services/languageFeatures.js';
import { classifyReference, documentationRanges, ReferenceCategory, referenceCategoryLabel, referenceCategoryOrder, referenceClassificationTargets } from './referenceCategories.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../common/services/resolverService.js';
import { OneReference, ReferencesModel } from '../referencesModel.js';
import './symbolNavigationPopup.css';

export type SymbolNavigationResult = OneReference | { references: LocationLink[] } | undefined;

const defaultColumnWidths = { file: 28, source: 46 };

interface UsageRow {
	readonly kind: 'usage';
	readonly origin: SourceOrigin;
	category: ReferenceCategory;
	readonly reference: OneReference;
	readonly file: string;
	readonly path: string;
}

interface UsageGroup {
	readonly kind: 'group';
	readonly category: ReferenceCategory;
	readonly file: string;
	readonly path: string;
	readonly children: UsageRow[];
}

type UsageItem = UsageRow | UsageGroup;

function usageIdentity(item: UsageItem): string {
	return item.kind === 'group' ? `category:${item.category}` : item.reference.id;
}

interface UsageTemplate {
	readonly row: HTMLElement;
	readonly icon: HTMLElement;
	readonly file: HTMLElement;
	readonly fileCell: HTMLElement;
	readonly sourceCell: HTMLElement;
	readonly hover: DisposableStore;
	preview?: HTMLElement;
	readonly line: HTMLElement;
	readonly code: HighlightedLabel;
	readonly path: HTMLElement;
	current?: UsageItem;
}

/** Keep navigation inside the active editor, including split editors and small windows. */
export function popupPlacement(bounds: { left: number; top: number; width: number; height: number }, caret: { left: number; top: number; height: number }, width: number, height: number): { x: number; y: number } {
	const below = caret.top + caret.height + 8;
	const above = caret.top - height - 8;
	return {
		x: bounds.left + clamp(caret.left - width / 3, 8, bounds.width - width - 8),
		y: bounds.top + clamp(below + height <= bounds.height - 8 ? below : above, 8, bounds.height - height - 8)
	};
}

const categoryIcons: Record<ReferenceCategory, ThemeIcon> = {
	implementations: Codicon.goToFile,
	usages: Codicon.references,
	tests: Codicon.beaker,
	documentation: Codicon.book,
	declarations: Codicon.symbolInterface,
	imports: Codicon.cloudDownload,
	resources: Codicon.settingsGear,
	other: Codicon.symbolMisc
};

/** Keeps editor columns aligned with the highlighted text after indentation is removed. */
export function usageSnippet(line: string, range: IRange): { text: string; start: number; end: number } {
	const indent = line.length - line.trimStart().length;
	const text = line.trim();
	const start = Math.min(text.length, Math.max(0, range.startColumn - 1 - indent));
	const end = range.endLineNumber === range.startLineNumber
		? Math.min(text.length, Math.max(start, range.endColumn - 1 - indent))
		: text.length;
	return { text, start, end };
}

/** A per-invocation view. It never owns or mutates the language provider's reference model. */
export class SymbolNavigationPopup extends Disposable {
	private readonly models = new Map<string, Promise<IReference<IResolvedTextEditorModel> | undefined>>();
	private closeView: (() => void) | undefined;
	private finish: ((value: SymbolNavigationResult) => void) | undefined;
	private result: SymbolNavigationResult;
	private root: HTMLElement | undefined;
	private list: ObjectTree<UsageItem> | undefined;
	private filter: HTMLInputElement | undefined;
	private count: HTMLElement | undefined;
	private empty: HTMLElement | undefined;
	private footer: HTMLElement | undefined;
	private currentFileOnly = false;
	private groupByType = true;
	private classifying = false;
	private readonly collapsedCategories = new Set<string>();
	private updating = false;
	private hasResults = false;
	private interactedWithResults = false;
	private rows: UsageRow[] = [];
	private rowHeight = 32;
	private listContainer: HTMLElement | undefined;
	private anchorOrigin: { x: number; y: number } | undefined;
	private requestedSize: { width: number; height: number } | undefined;
	private readonly resizeControls: HTMLElement[] = [];
	private readonly templates = new Set<UsageTemplate>();
	private fileHeading: HTMLElement | undefined;
	private sourceHeading: HTMLElement | undefined;
	private fileWidth = defaultColumnWidths.file;
	private sourceWidth = defaultColumnWidths.source;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly model: ReferencesModel,
		private readonly token: CancellationToken,
		private readonly isUsages: boolean,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ILabelService private readonly labelService: ILabelService,
		@ITextModelService private readonly resolverService: ITextModelService,
		@ILanguageFeaturesService private readonly languageFeatures: ILanguageFeaturesService,
		@IHoverService private readonly hoverService: IHoverService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService
	) {
		super();
	}

	show(): Promise<SymbolNavigationResult> {
		if (this.token.isCancellationRequested || !this.editor.hasModel()) {
			return Promise.resolve(undefined);
		}
		this.rows = this.model.references.map(reference => this.createRow(reference, 'other'));
		this.groupByType = this.isUsages;
		this.classifying = this.isUsages;
		return new Promise(resolve => {
			this.finish = resolve;
			const view = this.contextViewService.showContextView({
				hostAsPopover: true,
				getAnchor: () => {
					this.layout();
					const bounds = this.bounds();
					const position = this.editor.getPosition();
					const caret = position && this.editor.getScrolledVisiblePosition(position);
					const placement = popupPlacement(bounds, caret ?? { left: 8, top: 8, height: 0 }, this.root?.offsetWidth ?? 0, this.root?.offsetHeight ?? 0);
					const origin = this.anchorOrigin ??= placement;
					return {
						x: Math.max(bounds.left + 8, Math.min(origin.x, bounds.left + bounds.width - this.root!.offsetWidth - 8)),
						y: Math.max(bounds.top + 8, Math.min(origin.y, bounds.top + bounds.height - this.root!.offsetHeight - 8)),
						width: 0, height: 0
					};
				},
				render: container => this.render(container),
				focus: () => this.filter?.focus(),
				layout: () => this.layout(),
				onHide: () => {
					this.closeView = undefined;
					this.finish?.(this.token.isCancellationRequested ? undefined : this.result);
					this.finish = undefined;
				}
			}, this.editor.getDomNode()!);
			this.closeView = view.close;
			if (this.isUsages) {
				void this.classify();
			}
			this._register(this.token.onCancellationRequested(() => this.close()));
			this._register(this.editor.onDidScrollChange(() => this.close()));
			this._register(this.editor.onDidChangeModel(() => this.close()));
			this._register(this.editor.onDidDispose(() => this.close()));
			this._register(this.editor.onDidLayoutChange(() => this.contextViewService.layout()));
			this._register(this.editor.onDidChangeConfiguration(event => {
				if (event.hasChanged(EditorOption.fontInfo)) {
					for (const template of this.templates) {
						this.applyCodeFont(template.code.element.parentElement!);
					}
					this.contextViewService.layout();
				}
			}));
			if (this.token.isCancellationRequested) {
				this.close();
			}
		});
	}

	private close(result?: SymbolNavigationResult, restoreFocus = false): void {
		this.result = result;
		this.closeView?.();
		if (restoreFocus && !this.token.isCancellationRequested) {
			this.editor.focus();
		}
	}

	private render(container: HTMLElement): DisposableStore {
		const store = this._register(new DisposableStore());
		const root = this.root = dom.append(container, dom.$('.intellij-symbol-popup'));
		const workbench = this.editor.getDomNode()?.closest('.monaco-workbench');
		if (workbench) {
			const font = dom.getWindow(workbench).getComputedStyle(workbench);
			root.style.fontFamily = font.fontFamily;
			root.style.fontSize = font.fontSize;
		}
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-busy', String(this.classifying));
		root.setAttribute('aria-label', this.isUsages ? localize('usagePopup', "Usages") : this.model.title);
		const header = dom.append(root, dom.$('header.intellij-symbol-popup-header'));
		const expand = dom.append(header, dom.$<HTMLButtonElement>('button.intellij-symbol-popup-expand'));
		expand.type = 'button';
		expand.textContent = localize('expandResults', "Open Results");
		store.add(dom.addDisposableListener(expand, dom.EventType.CLICK, () => this.close({ references: this.rows.map(row => row.reference.link) })));
		const title = dom.append(header, dom.$('span.intellij-symbol-popup-title'));
		const position = this.editor.getPosition();
		const word = position && this.editor.getModel()?.getWordAtPosition(position)?.word;
		title.textContent = this.isUsages
			? (word ? localize('usagesOf', "Usages of {0}", word) : localize('usages', "Usages"))
			: (word ? localize('destinationsOf', "{0} of {1}", this.model.title, word) : this.model.title);
		this.count = dom.append(header, dom.$('span.intellij-symbol-popup-count'));
		this.count.setAttribute('role', 'status');
		this.count.setAttribute('aria-live', 'polite');
		const close = dom.append(header, dom.$<HTMLButtonElement>('button.intellij-symbol-popup-close'));
		close.type = 'button';
		close.setAttribute('aria-label', localize('closePopup', "Close"));
		const closeIcon = dom.append(close, dom.$('span'));
		closeIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		closeIcon.setAttribute('aria-hidden', 'true');
		store.add(dom.addDisposableListener(close, dom.EventType.CLICK, () => this.close(undefined, true)));

		const controls = dom.append(root, dom.$('.intellij-symbol-popup-controls'));
		const filterLabel = dom.append(controls, dom.$('label.intellij-symbol-popup-filter-label'));
		dom.append(filterLabel, dom.$('span')).textContent = localize('filter', "Filter");
		const filter = this.filter = dom.append(filterLabel, dom.$<HTMLInputElement>('input.intellij-symbol-popup-filter'));
		filter.type = 'search';
		filter.placeholder = localize('filterLocations', "Filter by file, path, or source");
		filter.setAttribute('aria-label', localize('filterLocationsLabel', "Filter Results by File or Path"));
		const scope = dom.append(controls, dom.$<HTMLButtonElement>('button.intellij-symbol-popup-scope'));
		scope.type = 'button';
		scope.textContent = localize('currentFile', "Current File");
		scope.setAttribute('aria-pressed', 'false');
		store.add(dom.addDisposableListener(scope, dom.EventType.CLICK, () => {
			this.currentFileOnly = !this.currentFileOnly;
			scope.setAttribute('aria-pressed', String(this.currentFileOnly));
			this.update();
		}));
		store.add(dom.addDisposableListener(filter, dom.EventType.INPUT, () => this.update()));

		const grouping = dom.append(controls, dom.$<HTMLButtonElement>('button.intellij-symbol-popup-grouping'));
		grouping.type = 'button';
		grouping.hidden = !this.isUsages;
		grouping.textContent = localize('groupByType', "Group by Type");
		grouping.setAttribute('aria-pressed', String(this.groupByType));
		store.add(dom.addDisposableListener(grouping, dom.EventType.CLICK, () => {
			this.groupByType = !this.groupByType;
			grouping.setAttribute('aria-pressed', String(this.groupByType));
			this.update();
		}));

		const columns = dom.append(root, dom.$('.intellij-symbol-popup-columns'));
		const fileColumn = this.fileHeading = dom.append(columns, dom.$('span.intellij-symbol-popup-file-heading'));
		fileColumn.textContent = localize('fileColumn', "File");
		const sourceColumn = this.sourceHeading = dom.append(columns, dom.$('span.intellij-symbol-popup-source-heading'));
		sourceColumn.textContent = localize('sourceColumn', "Source");
		dom.append(columns, dom.$('span.intellij-symbol-popup-path-heading')).textContent = localize('pathColumn', "Path");
		for (const [index, label] of [localize('resizeFileColumn', "Resize File column"), localize('resizeSourceColumn', "Resize Source column")].entries()) {
			const handle = dom.append(columns, dom.$('.intellij-symbol-popup-column-resize'));
			handle.style.left = `${index === 0 ? this.fileWidth : this.fileWidth + this.sourceWidth}%`;
			handle.setAttribute('role', 'separator');
			handle.setAttribute('aria-orientation', 'vertical');
			handle.setAttribute('aria-valuemin', '15');
			handle.setAttribute('aria-valuemax', '85');
			this.installResize(handle, label, store, (dx) => {
				const change = dx / Math.max(1, root.clientWidth) * 100;
				if (index === 0) {
					const next = Math.max(15, Math.min(this.fileWidth + this.sourceWidth - 20, this.fileWidth + change));
					this.sourceWidth += this.fileWidth - next;
					this.fileWidth = next;
				} else {
					this.sourceWidth = Math.max(20, Math.min(85 - this.fileWidth, this.sourceWidth + change));
				}
				this.layout();
			}, () => { this.fileWidth = defaultColumnWidths.file; this.sourceWidth = defaultColumnWidths.source; this.layout(); });
		}
		const listContainer = this.listContainer = dom.append(root, dom.$('.intellij-symbol-popup-list'));
		for (const type of ['wheel', 'pointerdown', 'keydown']) {
			store.add(dom.addDisposableListener(listContainer, type, () => { this.interactedWithResults = true; }, true));
		}
		const list = this.list = store.add(new ObjectTree<UsageItem>('IntelliJSymbolNavigation', listContainer, {
			getHeight: () => this.rowHeight,
			getTemplateId: () => 'usage'
		}, [this.renderer()], {
			accessibilityProvider: {
				getWidgetAriaLabel: () => this.isUsages ? localize('usageResults', "Usage Results") : this.model.title,
				getWidgetRole: () => 'tree',
				getRole: () => 'treeitem',
				getAriaLabel: item => item.kind === 'usage' ? `${item.reference.ariaMessage}, ${item.origin.label}${item.origin.detail ? `, ${item.origin.detail}` : ''}` : localize('categoryGroup', "{0}, {1} references", item.file, item.children.length)
			},
			identityProvider: { getId: usageIdentity },
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: row => row.path },
			multipleSelectionSupport: false,
			indent: 0,
			expandOnlyOnTwistieClick: false
		}));
		const selectionBackground = 'color-mix(in srgb, var(--vscode-editorWidget-foreground) 12%, var(--vscode-editor-background))';
		const focusOutline = 'color-mix(in srgb, var(--vscode-editorWidget-foreground) 60%, var(--vscode-editor-background))';
		list.style({
			...defaultListStyles,
			listFocusBackground: selectionBackground,
			listActiveSelectionBackground: selectionBackground,
			listFocusAndSelectionBackground: selectionBackground,
			listInactiveSelectionBackground: selectionBackground,
			listInactiveFocusBackground: selectionBackground,
			listFocusForeground: 'var(--vscode-editorWidget-foreground)',
			listActiveSelectionForeground: 'var(--vscode-editorWidget-foreground)',
			listFocusAndSelectionForeground: 'var(--vscode-editorWidget-foreground)',
			listFocusOutline: focusOutline,
			listFocusAndSelectionOutline: focusOutline,
			listSelectionOutline: focusOutline,
			listInactiveFocusOutline: focusOutline
		});
		store.add(list.onDidChangeFocus(event => list.setSelection([...event.elements])));
		store.add(list.onDidChangeCollapseState(event => {
			const item = event.node.element;
			if (!this.updating && item?.kind === 'group') {
				if (event.node.collapsed) {
					this.collapsedCategories.add(item.category);
				} else {
					this.collapsedCategories.delete(item.category);
				}
				this.layout();
				this.contextViewService.layout();
			}
		}));
		store.add(list.onMouseClick(event => {
			if (event.element?.kind === 'usage') {
				this.close(event.element.reference);
			}
		}));
		this.empty = dom.append(root, dom.$('.intellij-symbol-popup-empty'));
		this.empty.textContent = localize('noLocations', "No results match this filter.");
		const footer = this.footer = dom.append(root, dom.$('footer.intellij-symbol-popup-footer'));
		const grip = dom.append(root, dom.$<HTMLButtonElement>('button.intellij-symbol-popup-resize'));
		grip.type = 'button';
		grip.classList.add(...ThemeIcon.asClassNameArray(Codicon.gripper));
		this.installResize(grip, localize('resizePopup', "Resize popup. Use arrow keys; double-click to reset."), store, (dx, dy) => {
			const rect = dom.getDomNodePagePosition(root);
			this.anchorOrigin ??= { x: rect.left, y: rect.top };
			this.requestedSize = { width: root.offsetWidth + dx, height: root.offsetHeight + dy };
			this.layout();
			this.contextViewService.layout();
		}, () => { this.anchorOrigin = undefined; this.requestedSize = undefined; this.layout(); this.contextViewService.layout(); });
		footer.textContent = localize('navigationHint', "↑ ↓ to select · Enter to open · Esc to close");
		store.add(dom.addStandardDisposableListener(root, dom.EventType.KEY_DOWN, event => {
			if (event.keyCode === KeyCode.Escape) {
				event.preventDefault();
				event.stopPropagation();
				this.close(undefined, true);
			} else if (event.target === filter && (event.keyCode === KeyCode.DownArrow || event.keyCode === KeyCode.UpArrow)) {
				event.preventDefault();
				event.stopPropagation();
				if (this.hasResults) {
					const navigator = list.navigate();
					const first = event.keyCode === KeyCode.DownArrow ? navigator.first() : navigator.last();
					let item = first;
					while (item?.kind === 'group') {
						item = event.keyCode === KeyCode.DownArrow ? navigator.next() : navigator.previous();
					}
					if (item ?? first) {
						list.setFocus([item ?? first!]);
					}
					list.domFocus();
				}
			} else if (event.keyCode === KeyCode.Enter && (event.target === filter || list.getHTMLElement().contains(event.target))) {
				event.preventDefault();
				event.stopPropagation();
				const item = list.getFocus()[0];
				if (item?.kind === 'usage') {
					this.close(item.reference);
				} else if (item?.kind === 'group') {
					list.toggleCollapsed(item);
				}
			} else if (event.keyCode === KeyCode.Tab) {
				const targets: HTMLElement[] = [filter, scope, ...(grouping.hidden ? [] : [grouping]), ...(this.hasResults ? [list.getHTMLElement()] : []), expand, close, ...this.resizeControls];
				const active = targets.findIndex(target => target === dom.getActiveElement() || target.contains(dom.getActiveElement()));
				const next = (active + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
				event.preventDefault();
				event.stopPropagation();
				targets[next].focus();
			}
		}, true));
		this.update(true);
		return store;
	}

	private renderer(): ITreeRenderer<UsageItem, void, UsageTemplate> {
		return {
			templateId: 'usage',
			renderTemplate: container => {
				const row = dom.append(container, dom.$('.intellij-symbol-popup-row'));
				const fileCell = dom.append(row, dom.$('.intellij-symbol-popup-file-cell'));
				const icon = dom.append(fileCell, dom.$('span.intellij-symbol-popup-icon'));
				icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.symbolMethod));
				icon.setAttribute('aria-hidden', 'true');
				const file = dom.append(fileCell, dom.$('span.intellij-symbol-popup-file'));
				const sourceCell = dom.append(row, dom.$('.intellij-symbol-popup-source-cell'));
				const line = dom.append(sourceCell, dom.$('span.intellij-symbol-popup-line'));
				const code = new HighlightedLabel(dom.append(sourceCell, dom.$('span.intellij-symbol-popup-code')));
				const path = dom.append(row, dom.$('span.intellij-symbol-popup-path'));
				const template: UsageTemplate = { row, icon, file, fileCell, sourceCell, line, code, path, hover: new DisposableStore() };
				const delegate = getDefaultHoverDelegate('element');
				template.hover.add(this.hoverService.setupManagedHover({
					delay: delegate.delay,
					placement: 'element',
					// The parent context view is a top-layer popover. Keep the hover in
					// that same layer, outside the popup's clipped results viewport.
					showHover: (options, focus) => delegate.showHover({ ...options, container: this.root?.parentElement ?? undefined }, focus),
					onDidHideHover: () => delegate.onDidHideHover?.()
				}, row, () => template.preview));
				this.templates.add(template);
				return template;
			},
			renderElement: (node, _index, template) => {
				const row = node.element;
				template.current = row;
				template.row.classList.toggle('intellij-symbol-popup-file-group', row.kind === 'group');
				template.row.dataset.category = row.category;
				template.row.style.gridTemplateColumns = this.columnGrid();
				template.preview = undefined;
				template.icon.hidden = row.kind !== 'group';
				this.applyCodeFont(template.code.element.parentElement!);
				template.icon.className = `intellij-symbol-popup-icon ${ThemeIcon.asClassName(categoryIcons[row.category])}`;
				template.file.textContent = row.file;
				template.path.textContent = row.path;
				template.file.title = row.file;
				template.path.title = row.path;
				if (row.kind === 'group') {
					template.line.textContent = String(row.children.length);
					template.code.set('');
					return;
				}
				template.line.textContent = String(row.reference.range.startLineNumber);
				template.code.set(localize('loadingSource', "Loading source…"));
				void this.resolve(row.reference.uri).then(reference => {
					if (this._store.isDisposed || template.current !== row) {
						return;
					}
					const textModel = reference?.object.textEditorModel;
					const range = row.reference.range;
					if (textModel && range.startLineNumber <= textModel.getLineCount()) {
						const snippet = usageSnippet(textModel.getLineContent(range.startLineNumber), range);
						template.code.set(snippet.text, [{ start: snippet.start, end: snippet.end }]);
						const preview = dom.$('.intellij-symbol-popup-preview');
						dom.append(preview, dom.$('div.intellij-symbol-popup-preview-title')).textContent = `${row.path}:${range.startLineNumber}`;
						const code = dom.append(preview, dom.$('pre'));
						this.applyCodeFont(code);
						for (let line = Math.max(1, range.startLineNumber - 2); line <= Math.min(textModel.getLineCount(), range.startLineNumber + 2); line++) {
							const sourceLine = dom.append(code, dom.$('div'));
							sourceLine.classList.toggle('match', line === range.startLineNumber);
							sourceLine.textContent = `${line}  ${textModel.getLineContent(line)}`;
						}
						template.preview = preview;
					} else {
						template.code.set(localize('sourceUnavailable', "Source preview unavailable"));
					}
				});
			},
			disposeElement: (_row, _index, template) => { template.current = undefined; template.preview = undefined; },
			disposeTemplate: template => { this.templates.delete(template); template.current = undefined; template.preview = undefined; template.hover.dispose(); template.code.dispose(); }
		};
	}

	private resolve(uri: URI): Promise<IReference<IResolvedTextEditorModel> | undefined> {
		const key = uri.toString();
		let promise = this.models.get(key);
		if (!promise) {
			promise = this.resolverService.createModelReference(uri).then(reference => {
				if (this._store.isDisposed) {
					reference.dispose();
					return undefined;
				}
				return this._register(reference);
			}, () => undefined);
			this.models.set(key, promise);
		}
		return promise;
	}

	private createRow(reference: OneReference, category: ReferenceCategory): UsageRow {
		return {
			kind: 'usage', category, reference,
			origin: sourceOrigin(reference.uri, !!this.workspaceService.getWorkspaceFolder(reference.uri)),
			file: basename(reference.uri),
			path: this.labelService.getUriLabel(reference.uri, { relative: true })
		};
	}

	private addTargets(targets: LocationLink[], category: 'declarations' | 'implementations'): void {
		if (!this.finish || this._store.isDisposed || this.token.isCancellationRequested || targets.length === 0) {
			return;
		}
		const model = this._register(new ReferencesModel([...targets], this.model.title));
		for (const reference of model.references) {
			const existing = this.rows.find(row => isEqual(row.reference.uri, reference.uri) && Range.equalsRange(row.reference.range, reference.range));
			if (existing) {
				if (category === 'implementations' || existing.category === 'other') {
					existing.category = category;
				}
			} else {
				this.rows.push(this.createRow(reference, category));
			}
		}
		this.update(!this.interactedWithResults);
		this.contextViewService.layout();
	}

	private async classify(): Promise<void> {
		const source = this.editor.getModel();
		const position = this.editor.getPosition();
		if (!source || !position) {
			return;
		}
		try {
			const { definitions, implementations, complete } = await referenceClassificationTargets(this.languageFeatures, source, position, this.token, (targets, category) => this.addTargets(targets, category));
			const uris = [...new Map(this.rows.map(row => [row.reference.uri.toString(), row.reference.uri])).values()];
			// Bound source loads; cancellation/closing must not enqueue the remaining files.
			for (let offset = 0; offset < uris.length; offset += 8) {
				if (!this.finish || this._store.isDisposed || this.token.isCancellationRequested) {
					return;
				}
				await Promise.all(uris.slice(offset, offset + 8).map(async uri => {
					const reference = await this.resolve(uri);
					if (!this.finish || this._store.isDisposed || this.token.isCancellationRequested) {
						return;
					}
					const textModel = reference?.object.textEditorModel;
					const documentation = textModel ? documentationRanges(textModel) : [];
					for (const row of this.rows) {
						if (isEqual(row.reference.uri, uri)) {
							row.category = classifyReference(row.reference, textModel, documentation, definitions, implementations, complete);
						}
					}
				}));
			}
		} catch {
			// Leave unresolved entries in Other References; source navigation still works.
		} finally {
			if (this.finish && !this._store.isDisposed && !this.token.isCancellationRequested) {
				this.classifying = false;
				this.update(!this.interactedWithResults);
				this.contextViewService.layout();
			}
		}
	}

	private update(resetScroll = false): void {
		const list = this.list;
		if (!list) {
			return;
		}
		const currentUri = this.editor.getModel()?.uri;
		const query = this.filter?.value.trim().toLocaleLowerCase() ?? '';
		const focused = list.getFocus()[0];
		const rows = this.rows.filter(row => (!this.currentFileOnly || isEqual(row.reference.uri, currentUri)) && (!query || `${row.path} ${row.origin.label} ${row.origin.detail ?? ''}`.toLocaleLowerCase().includes(query)));
		const groups = referenceCategoryOrder.map(category => ({
			kind: 'group' as const,
			category,
			file: referenceCategoryLabel(category),
			path: '',
			children: rows.filter(row => row.category === category)
		})).filter(group => group.children.length > 0);
		const children: IObjectTreeElement<UsageItem>[] = this.groupByType
			? groups.map(group => ({ element: group, collapsible: true, collapsed: this.collapsedCategories.has(group.category), children: group.children.map(row => ({ element: row })) }))
			: rows.map(row => ({ element: row }));
		this.updating = true;
		try {
			list.setChildren(null, children);
		} finally {
			this.updating = false;
		}
		this.hasResults = rows.length > 0;
		if (rows.length) {
			const visibleRows = this.groupByType ? groups.filter(group => !this.collapsedCategories.has(group.category)).flatMap(group => group.children) : rows;
			const candidates: UsageItem[] = [...visibleRows, ...(this.groupByType ? groups : [])];
			const next = (!resetScroll && candidates.find(item => focused && usageIdentity(item) === usageIdentity(focused))) || candidates[0];
			if (next) {
				list.setFocus([next]);
			}
		}

		this.count!.textContent = this.isUsages
			? localize('usageCount', "{0} of {1} references", rows.length, this.rows.length)
			: localize('destinationCount', "{0} of {1} results", rows.length, this.rows.length);
		this.empty!.hidden = rows.length > 0;
		this.empty!.textContent = this.classifying ? localize('loadingLocations', "Loading results…") : localize('noLocations', "No results match this filter.");
		this.root?.setAttribute('aria-busy', String(this.classifying));
		if (this.footer) {
			this.footer.textContent = this.classifying ? localize('classifyingReferences', "Classifying references…") : localize('navigationHint', "↑ ↓ to select · Enter to open · Esc to close");
		}
		this.layout();
		// Revealing before the first viewport layout scrolls a whole row out of view.
		// Initial classification must also keep the leading category heading visible.
		if (resetScroll) {
			list.scrollTop = 0;
		} else if (list.getFocus()[0]) {
			list.reveal(list.getFocus()[0]);
		}
		this.contextViewService.layout();
	}

	private bounds(): { left: number; top: number; width: number; height: number } {
		const node = this.editor.getDomNode()!;
		const window = dom.getWindow(node);
		const rect = dom.getDomNodePagePosition(node);
		const left = Math.max(window.scrollX, rect.left);
		const top = Math.max(window.scrollY, rect.top);
		return { left, top, width: Math.max(0, Math.min(rect.left + rect.width, window.scrollX + window.innerWidth) - left), height: Math.max(0, Math.min(rect.top + rect.height, window.scrollY + window.innerHeight) - top) };
	}

	/** Pointer capture keeps a drag alive outside the handle; all listeners belong to this view. */
	private installResize(handle: HTMLElement, label: string, store: DisposableStore, resize: (dx: number, dy: number) => void, reset: () => void): void {
		handle.tabIndex = 0;
		handle.setAttribute('aria-label', label);
		handle.title = label;
		this.resizeControls.push(handle);
		let previous: { x: number; y: number; id: number } | undefined;
		store.add(dom.addDisposableListener(handle, 'pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			handle.focus();
			previous = { x: event.clientX, y: event.clientY, id: event.pointerId };
			handle.setPointerCapture(event.pointerId);
		}));
		store.add(dom.addDisposableListener(handle, 'pointermove', (event: PointerEvent) => {
			if (previous?.id === event.pointerId) {
				resize(event.clientX - previous.x, event.clientY - previous.y);
				previous = { x: event.clientX, y: event.clientY, id: event.pointerId };
			}
		}));
		store.add(dom.addDisposableListener(handle, 'lostpointercapture', () => { previous = undefined; }));
		store.add(dom.addDisposableListener(handle, 'pointerup', () => { previous = undefined; }));
		store.add(dom.addDisposableListener(handle, 'dblclick', reset));
		store.add(dom.addStandardDisposableListener(handle, 'keydown', event => {
			const step = event.shiftKey ? 40 : 10;
			const dx = event.keyCode === KeyCode.LeftArrow ? -step : event.keyCode === KeyCode.RightArrow ? step : 0;
			const dy = event.keyCode === KeyCode.UpArrow ? -step : event.keyCode === KeyCode.DownArrow ? step : 0;
			if (dx || dy) {
				event.preventDefault();
				event.stopPropagation();
				resize(dx, dy);
			}
		}));
	}

	private columnGrid(): string {
		return `${this.fileWidth}% ${this.sourceWidth}% minmax(0, 1fr)`;
	}

	private applyCodeFont(element: HTMLElement): void {
		applyFontInfo(element, this.editor.getOption(EditorOption.fontInfo));
		// Compact previews share the editor's typeface, size, and weight; their
		// line spacing and shaping belong to the popup rather than the code editor.
		element.style.lineHeight = '';
		element.style.letterSpacing = '';
		element.style.fontFeatureSettings = '';
		element.style.fontVariationSettings = '';
	}

	private layout(): void {
		if (!this.root || !this.list || !this.listContainer) {
			return;
		}
		const rowHeight = Math.max(32, this.editor.getOption(EditorOption.fontInfo).lineHeight + 4);
		if (rowHeight !== this.rowHeight) {
			this.rowHeight = rowHeight;
			const navigator = this.list.navigate();
			for (let item = navigator.first(); item; item = navigator.next()) {
				this.list.updateElementHeight(item, rowHeight);
			}
		}
		const bounds = this.bounds();
		// Explicit viewport sizing prevents a virtualized tree's content height stretching the popup.
		const maxWidth = Math.max(1, bounds.width - 16);
		const maxHeight = Math.max(1, bounds.height - 16);
		const width = Math.min(maxWidth, Math.max(360, this.requestedSize?.width ?? Math.min(960, bounds.width * 0.9)));
		this.root.style.width = `${width}px`;
		this.fileHeading!.style.width = `${this.fileWidth}%`;
		this.sourceHeading!.style.width = `${this.sourceWidth}%`;
		this.resizeControls[0].style.left = `${this.fileWidth}%`;
		this.resizeControls[1].style.left = `${this.fileWidth + this.sourceWidth}%`;
		for (const template of this.templates) {
			template.row.style.gridTemplateColumns = this.columnGrid();
		}
		this.resizeControls[0]?.setAttribute('aria-valuenow', String(Math.round(this.fileWidth)));
		this.resizeControls[1]?.setAttribute('aria-valuenow', String(Math.round(this.fileWidth + this.sourceWidth)));
		const chrome = Array.from(this.root.children).filter(child => child !== this.listContainer && !(child as HTMLElement).hidden && !child.classList.contains('intellij-symbol-popup-resize')).reduce((height, child) => height + (child as HTMLElement).offsetHeight, this.root.offsetHeight - this.root.clientHeight);
		const desiredHeight = this.requestedSize?.height ?? chrome + Math.min(this.list.contentHeight, 320);
		const height = Math.min(maxHeight, Math.max(chrome, desiredHeight));
		const listHeight = Math.max(0, height - chrome);
		this.root.style.maxHeight = `${maxHeight}px`;
		this.listContainer.style.height = `${listHeight}px`;
		this.list.layout(listHeight, width - 2);
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}
