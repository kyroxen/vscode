/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { packageScriptTasks } from '../tasks';

suite('JavaScript Package Tasks', () => {
	const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/repo'), name: 'repo', index: 0 };

	function task(script: string, path?: string, scope: vscode.WorkspaceFolder | vscode.TaskScope = folder): vscode.Task {
		return new vscode.Task({ type: 'npm', script, path }, scope, script, 'npm', new vscode.ShellExecution('unused'));
	}

	test('selects only the active package and preserves native task objects and user options', () => {
		const expected = task('test', 'packages/app');
		expected.runOptions = { reevaluateOnRerun: false };
		const candidates = [task('test'), task('test', 'packages/other'), expected, task('test', 'packages/app', { ...folder, uri: vscode.Uri.file('/other') }), task('test', 'packages/app', vscode.TaskScope.Workspace)];
		assert.deepStrictEqual(packageScriptTasks(candidates, vscode.Uri.file('/repo/packages/app'), ['test']), [expected]);
		assert.strictEqual(packageScriptTasks(candidates, vscode.Uri.file('/repo/packages/app'), ['test'])[0], expected);
	});

	test('keeps generated install tasks and other task providers out of package scripts', () => {
		const native = task('test');
		const other = new vscode.Task({ type: 'custom', script: 'test' }, folder, 'test', 'other', new vscode.ShellExecution('unused'));
		assert.deepStrictEqual(packageScriptTasks([native, task('install'), other], folder.uri, ['test']), [native]);
	});

	test('retains remote authority when matching package locations', () => {
		const remote = { ...folder, uri: vscode.Uri.parse('vscode-remote://ssh-remote+host/repo') };
		const expected = task('test', 'packages/app', remote);
		assert.deepStrictEqual(packageScriptTasks([task('test', 'packages/app'), expected], vscode.Uri.joinPath(remote.uri, 'packages/app'), ['test']), [expected]);
	});
});
