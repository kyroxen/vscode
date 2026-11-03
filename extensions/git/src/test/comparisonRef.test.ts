/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { GitErrorCodes } from '../api/git.constants';
import { isComparisonRevision, resolveComparisonRef } from '../intellij/comparisonRef';

suite('Explorer Git comparison', () => {
	test('accepts Git revision syntax while rejecting options and control characters', () => {
		assert.deepStrictEqual(['main', 'origin/feature/test', 'v1.0', 'abc123', 'HEAD~1', 'HEAD@{1}', '', ' ', '--output=/tmp/test', 'main\nHEAD', 'main\0'].map(isComparisonRevision),
			[true, true, true, true, true, true, false, false, false, false, false]);
	});

	test('pins the comparison to a resolved commit and checks the selected file path', async () => {
		const calls: string[][] = [];
		const result = await resolveComparisonRef({
			getCommit: async ref => { calls.push(['commit', ref]); return { hash: 'stable-commit', parents: [], refNames: [], message: '' }; },
			getObjectDetails: async (ref, path) => { calls.push(['object', ref, path]); return { mode: '100644', object: 'blob', size: 10 }; },
			getEmptyTree: async () => { throw new Error('Unexpected empty tree'); }
		}, 'feature', '/repo/Selected.java');
		assert.deepStrictEqual({ result, calls }, { result: 'stable-commit', calls: [['commit', 'feature'], ['object', 'stable-commit', '/repo/Selected.java']] });
	});

	test('compares a newly added file against the native empty tree', async () => {
		const result = await resolveComparisonRef({
			getCommit: async () => ({ hash: 'commit', parents: [], refNames: [], message: '' }),
			getObjectDetails: async () => { throw Object.assign(new Error('Missing path'), { gitErrorCode: GitErrorCodes.UnknownPath }); },
			getEmptyTree: async () => 'empty-tree'
		}, 'main', '/repo/New.java');
		assert.strictEqual(result, 'empty-tree');
	});

	test('propagates invalid references and object-read failures instead of showing an empty baseline', async () => {
		const failure = new Error('Git failed');
		for (const failCommit of [true, false]) {
			await assert.rejects(resolveComparisonRef({
				getCommit: async () => { if (failCommit) { throw failure; } return { hash: 'commit', parents: [], refNames: [], message: '' }; },
				getObjectDetails: async () => { throw failure; },
				getEmptyTree: async () => { throw new Error('Unexpected empty tree'); }
			}, 'bad-reference', '/repo/Selected.java'), error => error === failure);
		}
	});
});
