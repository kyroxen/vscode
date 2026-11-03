/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { BreadcrumbsWidget } from '../../../../../base/browser/ui/breadcrumbs/breadcrumbsWidget.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';

/** Reuse native revealing after its deferred dimensions and scrollbar measurements settle. */
export class BreadcrumbsTail extends Disposable {
	private readonly pending = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		private readonly widget: Pick<BreadcrumbsWidget, 'isDOMFocused' | 'revealLast'>,
		private readonly window: Window,
		private readonly canReveal: () => boolean,
		private readonly measure: typeof dom.measure = dom.measure
	) {
		super();
	}

	layout(): void {
		const store = new DisposableStore();
		this.pending.value = store;
		// Native scrollbar sizing uses two measurement passes. revealLast queues
		// its own final measurement, keeping layout and scroll offsets in sync.
		store.add(this.measure(this.window, () => {
			store.add(this.measure(this.window, () => {
				if (!this.widget.isDOMFocused() && this.canReveal()) {
					this.widget.revealLast();
				}
			}));
		}));
	}
}
