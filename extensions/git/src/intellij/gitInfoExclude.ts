/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { commands, Disposable, l10n, ProgressLocation, SourceControlResourceState, Uri, window } from 'vscode';
import type { Model } from '../model';
import type { Repository } from '../repository';
import { appendExcludePatterns, excludePattern } from './excludePatterns';

export function registerGitInfoExclude(model: Model): Disposable {
	// Serialize writes so simultaneous invocations cannot overwrite one another.
	let pending = Promise.resolve();
	const registrations = ['addToExclude', 'addToGitignore', 'stageChanges', 'discardChanges'].map(action =>
		commands.registerCommand(`gitInfoExclude.${action}`, (first: Uri | SourceControlResourceState | undefined, ...rest: (Uri | SourceControlResourceState | (Uri | SourceControlResourceState)[])[]) => {
			const run = async () => {
				try {
					const selection = rest.find(Array.isArray) ?? [first, ...rest.flat()];
					const uris = selection.flatMap(item => item instanceof Uri ? [item] : item?.resourceUri ? [item.resourceUri] : []);
					if (!uris.length && window.activeTextEditor) {
						uris.push(window.activeTextEditor.document.uri);
					}
					if (!uris.length) {
						throw new Error(l10n.t('No file selected.'));
					}
					const repositories = new Map<Repository, Map<string, Uri>>();
					for (const uri of uris) {
						const repository = uri.scheme === 'file' ? model.getRepository(uri) : undefined;
						if (!repository) {
							throw new Error(l10n.t('No Git repository found for {0}.', uri.toString()));
						}
						const files = repositories.get(repository) ?? new Map<string, Uri>();
						files.set(uri.toString(), uri);
						repositories.set(repository, files);
					}
					for (const [repository, files] of repositories) {
						if (action === 'addToExclude') {
							const patterns = [...files.values()].map(uri => excludePattern(repository.root, uri.fsPath));
							const target = path.join(repository.dotGit.commonPath ?? repository.dotGit.path, 'info', 'exclude');
							await fs.mkdir(path.dirname(target), { recursive: true });
							let existing = '';
							try {
								existing = await fs.readFile(target, 'utf8');
							} catch (error) {
								if (error.code !== 'ENOENT') {
									throw error;
								}
							}
							const updated = appendExcludePatterns(existing, patterns);
							if (updated !== existing) {
								await fs.writeFile(target, updated, 'utf8');
							}
							await repository.status();
							void window.showInformationMessage(l10n.t('Local Git exclude rules updated for {0}. Tracked files remain tracked.', repository.root));
						} else if (action === 'addToGitignore') {
							await repository.ignore([...files.values()]);
						} else {
							const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates, ...repository.mergeGroup.resourceStates]
								.filter(resource => [...files.values()].some(uri => {
									const relative = path.relative(uri.fsPath, resource.resourceUri.fsPath);
									return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
								}));
							if (resources.length) {
								await commands.executeCommand(action === 'stageChanges' ? 'git.stage' : 'git.clean', ...resources);
							} else {
								void window.showInformationMessage(l10n.t('No pending changes found for the selected paths in {0}.', repository.root));
							}
						}
					}
				} catch (error) {
					void window.showErrorMessage(l10n.t('Git action failed: {0}', error.message));
				}
			};
			pending = pending.then(() => window.withProgress({ location: ProgressLocation.Window, title: l10n.t('Updating Git…') }, run));
			return pending;
		}));
	return Disposable.from(...registrations);
}
