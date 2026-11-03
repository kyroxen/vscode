/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendExcludePatterns, excludePattern } from '../intellij/excludePatterns';

suite('Git Info Exclude', () => {
	test('preserves existing rules and appends unique patterns on a new line', () => {
		assert.deepStrictEqual([
			appendExcludePatterns('# local\r\n/already', ['/already', '/new', '/new']),
			appendExcludePatterns('/already\n', ['/already'])
		], ['# local\r\n/already\n/new\n', '/already\n']);
	});

	test('rejects repository roots, outside paths, and line breaks', () => {
		const root = path.resolve('repo');
		for (const file of [root, path.resolve('outside'), path.join(root, 'bad\nname'), path.join(root, 'bad\rname')]) {
			assert.throws(() => excludePattern(root, file));
		}
	});

	test('Git matches literal paths and shares excludes with linked worktrees', async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'git-info-exclude-'));
		const root = path.join(temp, 'repo');
		const worktree = path.join(temp, 'linked');
		const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_COUNT: '0' } });
		try {
			await fs.mkdir(root);
			git(root, 'init', '--quiet');
			git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'initial');
			git(root, 'worktree', 'add', '--quiet', '--detach', worktree);
			const names = ['literal[1]*?.txt', '#note', '!note', 'trailing ', 'folder'];
			await fs.mkdir(path.join(root, 'nested'));
			for (const name of names) {
				await fs.writeFile(path.join(root, name), '');
				await fs.writeFile(path.join(root, 'nested', name), '');
				await fs.writeFile(path.join(worktree, name), '');
			}
			const target = git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude').trim();
			await fs.writeFile(target, appendExcludePatterns('# preserved', names.map(name => excludePattern(root, path.join(root, name)))));
			assert.deepStrictEqual({
				root: git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
				linked: git(worktree, 'ls-files', '--others', '--exclude-standard', '-z')
			}, {
				root: names.map(name => `nested/${name}`).sort(),
				linked: ''
			});
		} finally {
			await fs.rm(temp, { recursive: true, force: true });
		}
	});
});
