/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { sourceOrigin } from '../../../../editor/contrib/gotoSymbol/browser/intellij/sourceOrigin.js';
import { localize } from '../../../../nls.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IDecorationsService } from '../../../services/decorations/common/decorations.js';

/** Native tab decorations, breadcrumb homes, and a persistent source entry identify dependencies. */
export class SourceOriginContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.intellijSourceOrigin';
	private readonly sourceEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IDecorationsService decorationsService: IDecorationsService,
		@ILabelService labelService: ILabelService,
		@IEditorService private readonly editorService: IEditorService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();
		this._register(decorationsService.registerDecorationsProvider({
			label: localize('sourceOrigin', "Source Origin"),
			onDidChange: Event.None,
			provideDecorations: resource => {
				const origin = sourceOrigin(resource);
				return origin.kind === 'library' || origin.kind === 'jdk'
					? { letter: `[${origin.label}]`, tooltip: origin.description, bubble: false }
					: undefined;
			}
		}));
		this._register(editorService.onDidActiveEditorChange(() => this.updateSourceEntry()));
		this.updateSourceEntry();
		for (const scheme of ['jdt', 'jrt']) {
			this._register(labelService.registerFormatter({
				home: URI.from({ scheme, path: '/${archive}' }),
				onDidChangeFormatting: Event.None,
				formatting: ({ home }) => {
					const origin = sourceOrigin(home);
					return origin.kind === 'library' || origin.kind === 'jdk'
						? { label: `${origin.label}/${origin.detail}`, separator: '/' }
						: undefined;
				}
			}));
		}
	}

	private updateSourceEntry(): void {
		const resource = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		const origin = resource && sourceOrigin(resource);
		if (!origin || (origin.kind !== 'library' && origin.kind !== 'jdk')) {
			this.sourceEntry.clear();
			return;
		}
		const entry = {
			name: localize('sourceOrigin', "Source Origin"),
			text: `$(package) ${origin.label} · ${origin.detail}`,
			ariaLabel: `${origin.label}, ${origin.detail}`,
			tooltip: origin.description
		};
		if (this.sourceEntry.value) {
			this.sourceEntry.value.update(entry);
		} else {
			this.sourceEntry.value = this.statusbarService.addEntry(entry, SourceOriginContribution.ID, StatusbarAlignment.RIGHT, 99);
		}
	}
}
