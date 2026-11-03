/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { setupIntelliJ, type SetupOptions } from './setup.ts';
import { parse } from 'jsonc-parser';

async function fixture(t: TestContext): Promise<SetupOptions> {
	const directory = await mkdtemp(path.join(tmpdir(), 'intellij-setup-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const source = path.join(directory, 'source');
	await mkdir(path.join(source, 'example.java-1.0.0'), { recursive: true });
	const manifest = { publisher: 'example', name: 'java', version: '1.0.0' };
	await writeFile(path.join(source, 'example.java-1.0.0', 'package.json'), JSON.stringify(manifest));
	return { source, profile: path.join(directory, 'profile'), versions: { 'example.java': '1.0.0' }, javaCandidates: path.join(directory, 'jdks') };
}

test('setup isolates extensions and preserves user settings and keybindings across reruns', async t => {
	const options = await fixture(t);
	const user = path.join(options.profile, 'user-data', 'User');
	await mkdir(user, { recursive: true });
	await writeFile(path.join(user, 'settings.json'), '{\n// Keep my preference\n"workbench.colorTheme": "Custom Theme"\n}');
	await writeFile(path.join(user, 'keybindings.json'), '[{"key":"cmd+o","command":"my.open"}]');
	const first = await setupIntelliJ(options);
	const settings = await readFile(path.join(user, 'settings.json'), 'utf8');
	const bindings = await readFile(path.join(user, 'keybindings.json'), 'utf8');
	await setupIntelliJ(options);
	assert.deepStrictEqual({
		installed: first.installed,
		keptComment: settings.includes('// Keep my preference'),
		keptTheme: settings.includes('Custom Theme'),
		lastBinding: JSON.parse(bindings).at(-1),
		stableBindings: bindings === await readFile(path.join(user, 'keybindings.json'), 'utf8'),
		stableSettings: settings === await readFile(path.join(user, 'settings.json'), 'utf8'),
		source: JSON.parse(await readFile(path.join(options.source, 'example.java-1.0.0', 'package.json'), 'utf8'))
	}, {
		installed: [{ id: 'example.java', version: '1.0.0' }],
		keptComment: true, keptTheme: true,
		lastBinding: { key: 'cmd+o', command: 'my.open' },
		stableBindings: true, stableSettings: true,
		source: { publisher: 'example', name: 'java', version: '1.0.0' }
	});
});

test('setup rejects missing pinned tooling before creating the profile', async t => {
	const options = await fixture(t);
	options.versions['missing.java'] = '1.0.0';
	await assert.rejects(setupIntelliJ(options), /Missing missing.java@1.0.0/);
	await assert.rejects(readFile(path.join(options.profile, 'tooling.json')), { code: 'ENOENT' });
});

test('setup adds new Java defaults to an existing language block without replacing user choices', async t => {
	const options = await fixture(t);
	const user = path.join(options.profile, 'user-data', 'User');
	await mkdir(user, { recursive: true });
	await writeFile(path.join(user, 'settings.json'), '{\n// User language choices\n"[java]": { "editor.tabSize": 2, "editor.gotoLocation.multipleDefinitions": "goto" }\n}');
	await setupIntelliJ(options);
	const text = await readFile(path.join(user, 'settings.json'), 'utf8');
	const java = parse(text)['[java]'];
	assert.deepStrictEqual({ comment: text.includes('// User language choices'), tabSize: java['editor.tabSize'], definitions: java['editor.gotoLocation.multipleDefinitions'], references: java['editor.gotoLocation.multipleReferences'] }, {
		comment: true, tabSize: 2, definitions: 'goto', references: 'pick'
	});
});

test('setup refuses a destination inside the source installation', async t => {
	const options = await fixture(t);
	options.profile = path.join(options.source, 'profile');
	await assert.rejects(setupIntelliJ(options), /must be separate/);
});

test('setup rejects incomplete packs and platform-specific extensions for another platform', async t => {
	const options = await fixture(t);
	const manifest = path.join(options.source, 'example.java-1.0.0', 'package.json');
	await writeFile(manifest, JSON.stringify({ publisher: 'example', name: 'java', version: '1.0.0', extensionPack: ['missing.dependency'] }));
	await assert.rejects(setupIntelliJ(options), /requires missing.dependency/);
	await writeFile(manifest, JSON.stringify({ publisher: 'example', name: 'java', version: '1.0.0', __metadata: { targetPlatform: 'another-platform' } }));
	await assert.rejects(setupIntelliJ(options), /Missing example.java/);
});
