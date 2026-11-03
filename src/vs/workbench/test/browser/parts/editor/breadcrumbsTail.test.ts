/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BreadcrumbsTail } from '../../../../browser/parts/editor/intellij/breadcrumbsTail.js';

suite('IntelliJ Breadcrumbs Tail', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture() {
		const callbacks = new Set<() => void>();
		let reveals = 0;
		let focused = false;
		let visible = true;
		const tail = store.add(new BreadcrumbsTail({ isDOMFocused: () => focused, revealLast: () => { reveals++; } }, mainWindow, () => visible, (_window, callback) => {
			callbacks.add(callback);
			return toDisposable(() => { callbacks.delete(callback); });
		}));
		return {
			tail,
			get reveals() { return reveals; },
			focus: () => { focused = true; },
			hide: () => { visible = false; },
			frame: () => {
				for (const callback of [...callbacks]) {
					callbacks.delete(callback);
					callback();
				}
			}
		};
	}

	test('reveals the native last item after both layout measurement passes and coalesces layouts', () => {
		const f = fixture();
		f.tail.layout();
		f.tail.layout();
		assert.strictEqual(f.reveals, 0);
		f.frame();
		assert.strictEqual(f.reveals, 0);
		f.frame();
		assert.strictEqual(f.reveals, 1);
	});

	test('preserves keyboard navigation, skips hidden controls and cancels disposed work', () => {
		for (const action of ['focus', 'hide', 'dispose'] as const) {
			const f = fixture();
			f.tail.layout();
			f.frame();
			if (action === 'dispose') {
				f.tail.dispose();
			} else {
				f[action]();
			}
			f.frame();
			assert.strictEqual(f.reveals, 0);
		}
	});
});
