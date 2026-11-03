/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { CancellationTokenSource, commands, FileType, l10n, QuickPickItem, Uri, window, workspace } from 'vscode';
import type { Model } from '../model';
import { RefType } from '../api/git.constants';
import { toGitUri } from '../uri';
import { isComparisonRevision, resolveComparisonRef } from './comparisonRef';

interface ReferencePick extends QuickPickItem {
	readonly reference?: string;
}

/** The native repository, Git filesystem, and diff command own reference resolution and editor behavior. */
export async function compareGitFile(model: Model, uris: readonly Uri[]): Promise<void> {
	if (uris.length !== 1 || uris[0].scheme !== 'file' || ((await workspace.fs.stat(uris[0])).type & FileType.Directory)) {
		throw new Error(l10n.t('Select one file to compare with a Git branch, tag, or commit.'));
	}
	const uri = uris[0];
	await model.isInitialized;
	const repository = model.getRepository(uri);
	if (!repository) {
		throw new Error(l10n.t('No Git repository found for {0}.', uri.toString()));
	}
	const cancellation = new CancellationTokenSource();
	try {
		const picks = repository.getRefs({}, cancellation.token).then(refs => [
			{ label: l10n.t('Enter Branch, Tag, or Commit...') },
			...refs.filter(ref => ref.name && ref.name !== 'origin/HEAD').map(ref => ({
				label: ref.name!,
				reference: ref.commit ?? ref.name,
				description: ref.type === RefType.Head ? l10n.t('Branch') : ref.type === RefType.RemoteHead ? l10n.t('Remote Branch') : l10n.t('Tag')
			}))
		] satisfies ReferencePick[]);
		const choice = await window.showQuickPick<ReferencePick>(picks, {
			title: l10n.t('Compare {0} With...', path.basename(uri.fsPath)),
			placeHolder: l10n.t('Select a branch or tag, or enter a revision'),
			matchOnDescription: true
		}, cancellation.token);
		if (!choice) {
			return;
		}
		const reference = choice.reference ?? await window.showInputBox({
			prompt: l10n.t('Enter a branch, tag, commit hash, or revision such as HEAD~1'),
			validateInput: value => isComparisonRevision(value) ? undefined : l10n.t('Enter a Git revision without leading dashes or control characters.')
		}, cancellation.token);
		if (!reference) {
			return;
		}
		const originalRef = await resolveComparisonRef(repository, reference.trim(), uri.fsPath);
		await commands.executeCommand('vscode.diff', toGitUri(uri, originalRef), uri,
			l10n.t('{0} ({1} ↔ Working Tree)', path.basename(uri.fsPath), choice.reference ? choice.label : reference.trim()), { preview: false });
	} finally {
		cancellation.cancel();
		cancellation.dispose();
	}
}
