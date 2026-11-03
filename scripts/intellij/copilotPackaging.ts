/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

interface PackageManifest {
	dependencies?: Record<string, string>;
}

/** Restore extension-host runtime files excluded by the agent-host packaging rules. */
export async function restoreCopilotPackaging(root: string): Promise<void> {
	const extension = path.join(root, 'extensions', 'copilot');
	if (!existsSync(path.join(extension, 'package.json'))) {
		return;
	}
	const destination = path.join(root, '.build', 'extensions', 'copilot', 'node_modules');
	const copilot = findPackageDirectory(extension, '@github/copilot');
	const target = path.join(destination, '@github', 'copilot');
	await mkdir(target, { recursive: true });
	await rm(path.join(target, 'sdk'), { recursive: true, force: true });
	for (const file of ['package.json', 'LICENSE.md', 'sdk']) {
		await cp(path.join(copilot, file), path.join(target, file), { recursive: true });
	}

	// The production Copilot bundle externalizes these packages even though its
	// manifest lists them as development dependencies. Keep their runtime closure
	// local to the extension, including dependencies with different nested versions.
	for (const name of ['source-map-support', 'dotenv']) {
		await copyRuntimePackage(extension, destination, name, new Set());
	}
}

async function copyRuntimePackage(from: string, destination: string, name: string, ancestors: Set<string>): Promise<void> {
	const source = findPackageDirectory(from, name);
	const manifest = path.join(source, 'package.json');
	if (ancestors.has(source)) {
		return;
	}
	const target = path.join(destination, name);
	await rm(target, { recursive: true, force: true });
	await cp(source, target, {
		recursive: true,
		filter: file => file !== path.join(source, 'node_modules')
	});
	const metadata: PackageManifest = JSON.parse(await readFile(manifest, 'utf8'));
	const visited = new Set(ancestors).add(source);
	for (const dependency of Object.keys(metadata.dependencies ?? {})) {
		await copyRuntimePackage(source, path.join(target, 'node_modules'), dependency, visited);
	}
}

function findPackageDirectory(from: string, name: string): string {
	// Locate metadata without resolving an unexported package.json subpath.
	const require = createRequire(path.join(from, 'package.json'));
	for (const directory of require.resolve.paths(name) ?? []) {
		const candidate = path.join(directory, name);
		if (existsSync(path.join(candidate, 'package.json'))) {
			return candidate;
		}
	}
	throw new Error(`Cannot find required Copilot runtime package ${name} from ${from}`);
}
