/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { basename } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { GoToLocationValues } from '../../../common/config/editorOptions.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { OneReference, ReferencesModel } from './referencesModel.js';
import { SymbolNavigationPopup, SymbolNavigationResult } from './intellij/symbolNavigationPopup.js';

/** Categorized usages also discover destinations absent from the reference provider. */
export function shouldPickSymbolNavigation(preference: GoToLocationValues, referenceCount: number, isUsages: boolean): boolean {
	return preference === 'pick' && (referenceCount > 1 || isUsages);
}

export class SymbolNavigationPicker {
	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	pick(model: ReferencesModel, token: CancellationToken): Promise<OneReference | undefined>;
	pick(model: ReferencesModel, token: CancellationToken, editor: ICodeEditor, isUsages?: boolean): Promise<SymbolNavigationResult>;
	async pick(model: ReferencesModel, token: CancellationToken, editor?: ICodeEditor, isUsages = false): Promise<SymbolNavigationResult> {
		if (editor?.getDomNode()) {
			const store = new DisposableStore();
			try {
				return await store.add(this.instantiationService.createInstance(SymbolNavigationPopup, editor, model, token, isUsages)).show();
			} finally {
				store.dispose();
			}
		}
		const items = model.references.map(reference => ({
			label: basename(reference.uri),
			description: localize('symbolLocation', "{0}:{1}:{2}", this.labelService.getUriLabel(reference.uri, { relative: true }), reference.range.startLineNumber, reference.range.startColumn),
			ariaLabel: reference.ariaMessage,
			reference
		}));
		const result = await this.quickInputService.pick(items, {
			title: model.title,
			placeHolder: localize('chooseSymbolLocation', "Choose a destination"),
			matchOnDescription: true
		}, token);
		return token.isCancellationRequested ? undefined : result?.reference;
	}
}
