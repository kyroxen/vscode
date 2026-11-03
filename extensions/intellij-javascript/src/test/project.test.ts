/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { describeProject, ProjectDirectory } from '../project';

suite('JavaScript Project Detection', () => {
	function directory(uri: string, files: string[], manifest?: object): ProjectDirectory {
		return { uri, files, manifest: manifest ? JSON.stringify(manifest) : undefined };
	}

	test('detects React, package scripts, package manager, language config, and configured tooling', () => {
		const project = describeProject([directory('file:///web', ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'eslint.config.mjs', '.prettierrc'], {
			name: 'web', dependencies: { react: '19' }, devDependencies: { vitest: '4' }, scripts: { dev: 'vite', test: 'vitest', invalid: 1 }
		})]);
		assert.deepStrictEqual(project, {
			directory: 'file:///web', name: 'web', language: 'TypeScript', manager: 'pnpm', framework: 'React',
			tools: [{ name: 'ESLint', extension: 'dbaeumer.vscode-eslint' }, { name: 'Prettier', extension: 'esbenp.prettier-vscode' }, { name: 'Vitest', extension: 'vitest.explorer' }],
			scripts: ['dev', 'test'], config: 'file:///web/tsconfig.json'
		});
	});

	test('uses the nearest package in a monorepo and inherits shared tooling and package manager', () => {
		const root = directory('file:///repo', ['package.json', 'pnpm-lock.yaml', 'eslint.config.js'], { name: 'root', packageManager: 'pnpm@10', devDependencies: { prettier: '3' }, scripts: { build: 'root-build' } });
		const leaf = directory('file:///repo/packages/server', ['package.json'], { name: 'server', scripts: { start: 'node index.cjs' } });
		const project = describeProject([root, directory('file:///repo/packages', []), leaf, directory('file:///repo/packages/server/src', [])]);
		assert.deepStrictEqual({ directory: project?.directory, scripts: project?.scripts, manager: project?.manager, tools: project?.tools.map(tool => tool.name) }, {
			directory: leaf.uri, scripts: ['start'], manager: 'pnpm', tools: ['ESLint', 'Prettier']
		});
	});

	test('keeps nested language configs associated with the enclosing package and honors nearer manager declarations', () => {
		const project = describeProject([
			directory('file:///repo', ['package.json', 'yarn.lock'], { packageManager: 'yarn@4' }),
			directory('file:///repo/app', ['package.json'], { name: 'app', packageManager: 'bun@1', scripts: { test: 'bun test' } }),
			directory('file:///repo/app/src', ['jsconfig.json'])
		]);
		assert.deepStrictEqual({ directory: project?.directory, manager: project?.manager, config: project?.config, scripts: project?.scripts }, {
			directory: 'file:///repo/app', manager: 'bun', config: 'file:///repo/app/src/jsconfig.json', scripts: ['test']
		});
	});

	test('isolates unrelated workspace folders and supports configuration-only projects', () => {
		assert.deepStrictEqual([
			describeProject([directory('file:///backend', ['pom.xml'])]),
			describeProject([directory('vscode-remote://ssh/web', ['jsconfig.json'])])
		], [undefined, {
			directory: 'vscode-remote://ssh/web', name: undefined, language: 'JavaScript', manager: 'npm', framework: undefined,
			tools: [], scripts: [], config: 'vscode-remote://ssh/web/jsconfig.json'
		}]);
	});

	test('does not recommend formatters or test integrations absent from the project', () => {
		const project = describeProject([directory('file:///node', ['package.json', 'bun.lock'], { name: 'node', scripts: { start: 'node index.js' } })]);
		assert.deepStrictEqual({ tools: project?.tools, manager: project?.manager }, { tools: [], manager: 'bun' });
	});

	test('recognizes Biome and Jest without running configuration files', () => {
		const project = describeProject([directory('file:///app', ['package.json', 'biome.jsonc'], { devDependencies: { jest: '30' } })]);
		assert.deepStrictEqual(project?.tools.map(tool => tool.name), ['Biome', 'Jest']);
	});

	test('reports malformed package data instead of silently guessing a project', () => {
		assert.throws(() => describeProject([{ uri: 'file:///bad', files: ['package.json'], manifest: '{broken' }]), SyntaxError);
		assert.throws(() => describeProject([{ uri: 'file:///bad', files: ['package.json'], manifest: 'null' }]), /Invalid package.json/);
	});

	test('applies configuration below the package root without borrowing a parent framework', () => {
		const project = describeProject([
			directory('file:///repo', ['package.json'], { dependencies: { react: '19' } }),
			directory('file:///repo/server', ['package.json'], { name: 'server' }),
			directory('file:///repo/server/src', ['biome.json'])
		]);
		assert.deepStrictEqual({ directory: project?.directory, framework: project?.framework, tools: project?.tools.map(tool => tool.name) }, {
			directory: 'file:///repo/server', framework: undefined, tools: ['Biome']
		});
	});

	test('recognizes named TypeScript configurations without choosing between multiple project graphs', () => {
		const project = describeProject([directory('file:///web', ['tsconfig.app.json', 'tsconfig.node.json'])]);
		assert.deepStrictEqual({ language: project?.language, config: project?.config }, { language: 'TypeScript', config: undefined });
	});
});
