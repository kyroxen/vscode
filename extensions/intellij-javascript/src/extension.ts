/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { describeProject, JavaScriptProject, ProjectDirectory } from './project';
import { runPackageScript } from './tasks';

const projectCommand = 'intellij.javascript.project';
const languagePattern = /^(?:javascript|javascriptreact|typescript|typescriptreact)$/;
const ignoredPath = /(?:^|\/)(?:node_modules|\.git|dist|build|coverage|\.next)(?:\/|$)/;
const watchedFiles = '**/{package.json,jsconfig*.json,tsconfig*.json,*lock*,npm-shrinkwrap.json,eslint.config.*,prettier.config.*,.eslintrc*,.prettierrc*,biome.json,biome.jsonc}';

interface ProjectAction extends vscode.QuickPickItem {
	run(): Thenable<unknown>;
}

/** Native UI and commands remain responsible for execution, trust, configuration, and errors. */
export function activate(context: vscode.ExtensionContext): void {
	const status = vscode.window.createStatusBarItem('intellij.javascript.project', vscode.StatusBarAlignment.Right, 98);
	status.name = vscode.l10n.t('JavaScript Project');
	status.command = projectCommand;
	context.subscriptions.push(status);
	const output = vscode.window.createOutputChannel(vscode.l10n.t('JavaScript Project'), { log: true });
	context.subscriptions.push(output);
	const directories = new Map<string, Promise<ProjectDirectory>>();
	let revision = 0;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const readDirectory = (uri: vscode.Uri): Promise<ProjectDirectory> => {
		const key = uri.toString();
		let result = directories.get(key);
		if (!result) {
			result = (async () => {
				const files = (await vscode.workspace.fs.readDirectory(uri)).filter(([, type]) => (type & vscode.FileType.Directory) === 0).map(([name]) => name);
				const manifest = files.includes('package.json') ? new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(uri, 'package.json'))) : undefined;
				return { uri: key, files, manifest };
			})();
			if (directories.size >= 256) {
				directories.clear();
			}
			directories.set(key, result);
		}
		return result;
	};

	const resolveProject = async (folder: vscode.WorkspaceFolder, resource?: vscode.Uri): Promise<JavaScriptProject | undefined> => {
		const chain: vscode.Uri[] = [];
		let current = resource ? vscode.Uri.joinPath(resource, '..') : folder.uri;
		while (current.path === folder.uri.path || current.path.startsWith(folder.uri.path.endsWith('/') ? folder.uri.path : `${folder.uri.path}/`)) {
			chain.unshift(current);
			if (current.path === folder.uri.path) {
				break;
			}
			current = vscode.Uri.joinPath(current, '..');
		}
		return describeProject(await Promise.all(chain.map(readDirectory)));
	};

	const activeProject = async (chooseFolder: boolean): Promise<JavaScriptProject | undefined> => {
		const document = vscode.window.activeTextEditor?.document;
		const activeFolder = document && !ignoredPath.test(document.uri.path) ? vscode.workspace.getWorkspaceFolder(document.uri) : undefined;
		const folders = vscode.workspace.workspaceFolders ?? [];
		const folder = activeFolder ?? (folders.length === 1 ? folders[0] : chooseFolder ? await vscode.window.showWorkspaceFolderPick() : undefined);
		return folder ? resolveProject(folder, activeFolder ? document?.uri : undefined) : undefined;
	};

	const refresh = async (): Promise<void> => {
		const expected = ++revision;
		status.hide();
		const document = vscode.window.activeTextEditor?.document;
		if (document && (!languagePattern.test(document.languageId) && !/\/(?:package|[jt]sconfig(?:\.[\w-]+)*)\.json$/.test(document.uri.path) || ignoredPath.test(document.uri.path))) {
			return;
		}
		try {
			const project = await activeProject(false);
			if (disposed || expected !== revision || !project) {
				return;
			}
			const runner = vscode.workspace.getConfiguration('npm', vscode.Uri.parse(project.directory)).get<string>('scriptRunner', 'auto');
			status.text = `$(code) ${project.framework ?? project.language} · ${runner === 'auto' ? project.manager : runner}`;
			status.tooltip = vscode.l10n.t('{0}\n{1}\nOpen scripts, debugging, tests, and project tooling.', project.name ?? project.language, vscode.workspace.asRelativePath(vscode.Uri.parse(project.directory)));
			status.accessibilityInformation = { label: status.tooltip };
			status.show();
		} catch (error) {
			output.error(error instanceof Error ? error : String(error));
		}
	};

	const scheduleRefresh = (): void => {
		revision++;
		directories.clear();
		clearTimeout(timer);
		timer = setTimeout(() => { void refresh(); }, 150);
	};

	const watchers: vscode.Disposable[] = [];
	const watchFolders = (): void => {
		watchers.splice(0).forEach(watcher => watcher.dispose());
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, watchedFiles));
			watchers.push(watcher);
			watchers.push(watcher.onDidChange(uri => { if (!ignoredPath.test(uri.path)) { scheduleRefresh(); } }));
			watchers.push(watcher.onDidCreate(uri => { if (!ignoredPath.test(uri.path)) { scheduleRefresh(); } }));
			watchers.push(watcher.onDidDelete(uri => { if (!ignoredPath.test(uri.path)) { scheduleRefresh(); } }));
		}
	};
	context.subscriptions.push(new vscode.Disposable(() => {
		disposed = true;
		revision++;
		clearTimeout(timer);
		watchers.splice(0).forEach(watcher => watcher.dispose());
		directories.clear();
	}));
	watchFolders();
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { watchFolders(); scheduleRefresh(); }));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => { void refresh(); }));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(scheduleRefresh));
	context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(scheduleRefresh));
	context.subscriptions.push(vscode.extensions.onDidChange(scheduleRefresh));

	context.subscriptions.push(vscode.commands.registerCommand(projectCommand, async () => {
		try {
			const project = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Reading JavaScript Project') }, () => activeProject(true));
			if (!project) {
				await vscode.window.showInformationMessage(vscode.l10n.t('Open a JavaScript package or a folder containing package.json, jsconfig.json, or tsconfig.json to use project tools.'));
				return;
			}
			const uri = vscode.Uri.parse(project.directory);
			const open = (target: vscode.Uri) => vscode.window.showTextDocument(target);
			const openLanguageConfig = (): Thenable<unknown> => {
				const document = vscode.window.activeTextEditor?.document;
				if (document && languagePattern.test(document.languageId)) {
					return vscode.commands.executeCommand(document.languageId.startsWith('typescript') ? 'typescript.goToProjectConfig' : 'javascript.goToProjectConfig');
				}
				return project.config ? open(vscode.Uri.parse(project.config)) : vscode.window.showInformationMessage(vscode.l10n.t('Open a JavaScript or TypeScript file to locate its language configuration.'));
			};
			const trusted = async (action: () => Thenable<unknown>): Promise<unknown> => {
				if (vscode.workspace.isTrusted) {
					return action();
				}
				const manage = vscode.l10n.t('Manage Workspace Trust');
				if (await vscode.window.showInformationMessage(vscode.l10n.t('Trust this workspace before running scripts or debugging.'), manage) === manage) {
					return vscode.commands.executeCommand('workbench.trust.manage');
				}
				return undefined;
			};
			const actions: ProjectAction[] = [
				{ label: vscode.l10n.t('Go to Symbol'), description: vscode.l10n.t('Functions, components, classes, and variables'), run: () => vscode.commands.executeCommand('workbench.action.showAllSymbols') },
				{ label: vscode.l10n.t('Run Package Script'), description: project.scripts.join(', ') || vscode.l10n.t('No scripts in this package'), run: () => trusted(() => runPackageScript(uri, project.scripts)) },
				{ label: vscode.l10n.t('Debug Application'), description: vscode.l10n.t('Select a native Node.js or browser debug configuration'), run: () => trusted(() => vscode.commands.executeCommand('workbench.action.debug.selectandstart')) },
				{ label: vscode.l10n.t('Open Tests'), description: vscode.l10n.t('Discover, run, and debug tests in the Testing view'), run: () => vscode.commands.executeCommand('workbench.view.extension.test') },
				{ label: vscode.l10n.t('Format Document With...'), description: vscode.l10n.t('Use the active file’s formatter configuration'), run: () => vscode.commands.executeCommand('editor.action.formatDocument.multiple') },
				{ label: vscode.l10n.t('Open Language Configuration'), description: vscode.l10n.t('Use the language service to locate or create project configuration'), run: openLanguageConfig }
			];
			if (project.scripts.length || (await readDirectory(uri)).files.includes('package.json')) {
				actions.push({ label: vscode.l10n.t('Open Package Configuration'), description: 'package.json', run: () => open(vscode.Uri.joinPath(uri, 'package.json')) });
			}
			for (const tool of project.tools) {
				const installed = vscode.extensions.getExtension(tool.extension);
				actions.push({
					label: tool.name,
					description: installed ? vscode.l10n.t('Installed · Used by this project') : vscode.l10n.t('View extension for this project'),
					run: () => vscode.commands.executeCommand('workbench.extensions.search', `@id:${tool.extension}`)
				});
			}
			const selected = await vscode.window.showQuickPick(actions, { title: vscode.l10n.t('{0} Project Tools', project.name ?? project.language), placeHolder: vscode.l10n.t('Choose an action for {0}', vscode.workspace.asRelativePath(uri)), matchOnDescription: true });
			await selected?.run();
		} catch (error) {
			output.error(error instanceof Error ? error : String(error));
			await vscode.window.showErrorMessage(vscode.l10n.t('Could not open JavaScript project tools: {0}', error instanceof Error ? error.message : String(error)));
		}
	}));
	void refresh();
}
