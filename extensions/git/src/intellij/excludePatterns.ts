/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export function excludePattern(root: string, file: string): string {
	const relative = path.relative(root, file);
	if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /[\r\n]/.test(relative)) {
		throw new Error('Select a path inside the repository without line breaks.');
	}
	return '/' + relative.split(path.sep).join('/').replace(/[\\*?\[\] ]/g, character => `\\${character}`);
}

export function appendExcludePatterns(existing: string, patterns: string[]): string {
	const lines = new Set(existing.split(/\r?\n/));
	const added = patterns.filter(pattern => {
		if (lines.has(pattern)) {
			return false;
		}
		lines.add(pattern);
		return true;
	});
	return added.length ? existing + (existing && !existing.endsWith('\n') ? '\n' : '') + added.join('\n') + '\n' : existing;
}
