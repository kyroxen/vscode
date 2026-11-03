/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitErrorCodes } from '../api/git.constants';
import type { Repository } from '../repository';

/** Git's revision syntax is allowed, but command-line options and control characters are not. */
export function isComparisonRevision(value: string): boolean {
	return value.trim().length > 0 && !value.trim().startsWith('-') && !/[\x00-\x1f\x7f]/.test(value);
}

/** Resolve a stable commit and use the native empty-tree baseline for newly added paths. */
export async function resolveComparisonRef(repository: Pick<Repository, 'getCommit' | 'getObjectDetails' | 'getEmptyTree'>, reference: string, path: string): Promise<string> {
	const commit = await repository.getCommit(reference);
	try {
		await repository.getObjectDetails(commit.hash, path);
		return commit.hash;
	} catch (error) {
		if (error.gitErrorCode !== GitErrorCodes.UnknownPath) {
			throw error;
		}
		return repository.getEmptyTree();
	}
}
