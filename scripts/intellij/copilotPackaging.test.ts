/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { restoreCopilotPackaging } from './copilotPackaging.ts';

async function fixture(t: TestContext): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'intellij-packaging-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await put(root, 'extensions/copilot/package.json', '{}');
	await put(root, 'extensions/copilot/node_modules/@github/copilot/package.json', '{"version":"1.0.73","exports":{"./sdk":{"import":"./sdk/index.js"}}}');
	await put(root, 'extensions/copilot/node_modules/@github/copilot/LICENSE.md', 'license');
	await put(root, 'extensions/copilot/node_modules/@github/copilot/sdk/index.js', 'pinned extension SDK');
	await put(root, 'extensions/copilot/node_modules/source-map-support/package.json', '{"dependencies":{"source-map":"1"}}');
	await put(root, 'extensions/copilot/node_modules/source-map/package.json', '{"version":"1"}');
	await put(root, 'extensions/copilot/node_modules/dotenv/package.json', '{}');
	return root;
}

async function put(root: string, file: string, contents: string): Promise<void> {
	const target = path.join(root, file);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents);
}

test('packaging restores the extension-pinned SDK and runtime dependencies without changing the agent host', async t => {
	const root = await fixture(t);
	const output = '.build/extensions/copilot/node_modules';
	await put(root, `${output}/@github/copilot/sdk/stale.js`, 'obsolete');
	await put(root, 'node_modules/@github/copilot-sdk/package.json', '{"version":"newer-agent-sdk"}');
	await restoreCopilotPackaging(root);
	await restoreCopilotPackaging(root);
	assert.deepStrictEqual({
		sdk: await readFile(path.join(root, output, '@github/copilot/sdk/index.js'), 'utf8'),
		stale: existsSync(path.join(root, output, '@github/copilot/sdk/stale.js')),
		transitive: JSON.parse(await readFile(path.join(root, output, 'source-map-support/node_modules/source-map/package.json'), 'utf8')),
		dotenv: existsSync(path.join(root, output, 'dotenv/package.json')),
		agent: JSON.parse(await readFile(path.join(root, 'node_modules/@github/copilot-sdk/package.json'), 'utf8'))
	}, {
		sdk: 'pinned extension SDK', stale: false, transitive: { version: '1' }, dotenv: true,
		agent: { version: 'newer-agent-sdk' }
	});
});

test('packaging resolves nested dependency versions instead of substituting hoisted versions', async t => {
	const root = await fixture(t);
	await put(root, 'extensions/copilot/node_modules/source-map-support/node_modules/source-map/package.json', '{"version":"nested"}');
	await restoreCopilotPackaging(root);
	assert.deepStrictEqual(JSON.parse(await readFile(path.join(root, '.build/extensions/copilot/node_modules/source-map-support/node_modules/source-map/package.json'), 'utf8')), { version: 'nested' });
});

test('packaging fails when the pinned SDK is unavailable instead of shipping an incomplete app', async t => {
	const root = await fixture(t);
	await rm(path.join(root, 'extensions/copilot/node_modules/@github/copilot/sdk'), { recursive: true });
	await assert.rejects(restoreCopilotPackaging(root), { code: 'ENOENT' });
});
