/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function packageScriptTasks(tasks: readonly vscode.Task[], directory: vscode.Uri, scripts: readonly string[]): vscode.Task[] {
	return tasks.filter(task => {
		if (!task.scope || typeof task.scope !== 'object' || task.definition.type !== 'npm' || typeof task.definition.script !== 'string' || !scripts.includes(task.definition.script)) {
			return false;
		}
		const path = task.definition.path;
		return (path === undefined || typeof path === 'string') && vscode.Uri.joinPath(task.scope.uri, path ?? '.').toString() === directory.toString();
	});
}

/** Keep native task executions, dependencies, package-manager selection, and user overrides intact. */
export async function runPackageScript(directory: vscode.Uri, scripts: readonly string[]): Promise<void> {
	const tasks = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Finding Package Scripts') }, async () => {
		const detected = await vscode.tasks.fetchTasks({ type: 'npm' });
		return packageScriptTasks(detected, directory, scripts);
	});
	if (!tasks.length) {
		const settings = vscode.l10n.t('Open Task Detection Settings');
		if (await vscode.window.showInformationMessage(vscode.l10n.t('No package script tasks were found. Check this package’s scripts and npm task detection settings.'), settings) === settings) {
			await vscode.commands.executeCommand('workbench.action.openSettings', '@id:npm.autoDetect');
		}
		return;
	}
	const selected = await vscode.window.showQuickPick(tasks.map(task => ({ label: task.definition.script as string, description: task.detail, task })), {
		title: vscode.l10n.t('Run Package Script'), placeHolder: vscode.l10n.t('Choose a script from {0}', vscode.workspace.asRelativePath(directory))
	});
	if (selected) {
		await vscode.tasks.executeTask(selected.task);
	}
}
