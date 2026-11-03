/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profileVersion = 2;
const readJSON = async <T>(file: string | URL): Promise<T> => JSON.parse(await readFile(file, 'utf8'));

interface ExtensionManifest {
	publisher: string;
	name: string;
	version: string;
	__metadata?: { targetPlatform?: string };
	extensionDependencies?: string[];
	extensionPack?: string[];
}

interface JavaRuntime {
	name: string;
	path: string;
	default?: boolean;
}

interface Keybinding {
	key: string;
	mac?: string;
	command: string;
	when?: string;
}

type PreferenceValue = string | boolean | { [key: string]: PreferenceValue };

interface Preferences {
	contributes: {
		configurationDefaults: Record<string, PreferenceValue>;
		keybindings: Keybinding[];
	};
}

export interface SetupOptions {
	source: string;
	profile: string;
	versions: Record<string, string>;
	javaCandidates?: string;
	tooling?: Tooling;
}

export type Tooling = 'all' | 'java' | 'javascript';

const commonExtensions = new Set(['k--kato.intellij-idea-keybindings', 'brennondenny.vsc-jetbrains-icons-enhanced']);
const javascriptExtensions = new Set(['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode']);

/** Versions have one source of truth; language bundles only select extension IDs. */
export function selectExtensions(versions: Record<string, string>, tooling: Tooling): Record<string, string> {
	return Object.fromEntries(Object.entries(versions).filter(([id]) => tooling === 'all' || commonExtensions.has(id) || (tooling === 'javascript' ? javascriptExtensions.has(id) : !javascriptExtensions.has(id))));
}

function hasErrorCode(error: object, code: string): boolean {
	return Reflect.get(error, 'code') === code;
}

async function canonicalPath(file: string): Promise<string> {
	try {
		return await realpath(file);
	} catch (error) {
		if (!(error instanceof Error) || !hasErrorCode(error, 'ENOENT')) {
			throw error;
		}
		return path.join(await canonicalPath(path.dirname(file)), path.basename(file));
	}
}

async function readOptional(file: string, fallback: string): Promise<string> {
	try {
		return await readFile(file, 'utf8');
	} catch (error) {
		if (!(error instanceof Error) || !hasErrorCode(error, 'ENOENT')) {
			throw error;
		}
		return fallback;
	}
}

export async function setupIntelliJ({ source, profile, versions, tooling = 'all', javaCandidates = path.join(homedir(), '.sdkman', 'candidates', 'java') }: SetupOptions) {
	versions = selectExtensions(versions, tooling);
	source = await realpath(source);
	profile = await canonicalPath(path.resolve(profile));
	const extensionsDir = path.join(profile, 'extensions');
	if (profile === source || profile.startsWith(source + path.sep) || source.startsWith(profile + path.sep)) {
		throw new Error('The IntelliJ profile must be separate from the source extensions directory.');
	}
	const candidates = new Map<string, { manifest: ExtensionManifest; directory: string; name: string }>();
	for (const entry of await readdir(source, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const manifestPath = path.join(source, entry.name, 'package.json');
		const text = await readOptional(manifestPath, 'null');
		const manifest: ExtensionManifest | null = JSON.parse(text);
		if (manifest) {
			const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
			if (versions[id] === manifest.version) {
				const target = manifest.__metadata?.targetPlatform;
				if (!target || target === 'undefined' || target === 'universal' || target === `${process.platform}-${process.arch}`) {
					candidates.set(id, { manifest, directory: path.join(source, entry.name), name: entry.name });
				}
			}
		}
	}
	// Preflight the whole set before copying anything. Never let extension packs silently
	// attempt to retrieve missing dependencies from an unconfigured gallery.
	for (const [id, version] of Object.entries(versions)) {
		const candidate = candidates.get(id);
		if (!candidate) {
			throw new Error(`Missing ${id}@${version} for ${process.platform}-${process.arch}. Install it in ${source}, then rerun setup.`);
		}
		for (const dependency of [...(candidate.manifest.extensionDependencies ?? []), ...(candidate.manifest.extensionPack ?? [])]) {
			if (!candidates.has(dependency.toLowerCase())) {
				throw new Error(`${id} requires ${dependency}; add its installed version to scripts/intellij/extensions.json.`);
			}
		}
	}
	const preferences = await readJSON<Preferences>(path.join(root, 'extensions/intellij-experience/package.json'));
	await mkdir(extensionsDir, { recursive: true });
	const installed = [];
	for (const [id, candidate] of candidates) {
		const destination = path.join(extensionsDir, candidate.name);
		const existing = await readOptional(path.join(destination, 'package.json'), 'null');
		if (JSON.parse(existing)?.version !== candidate.manifest.version) {
			const staging = `${destination}.installing`;
			await rm(staging, { recursive: true, force: true });
			await cp(candidate.directory, staging, { recursive: true });
			await rename(staging, destination);
		}
		installed.push({ id, version: candidate.manifest.version });
	}
	const userDir = path.join(profile, 'user-data', 'User');
	await mkdir(userDir, { recursive: true });
	const settingsFile = path.join(userDir, 'settings.json');
	let settingsText = await readOptional(settingsFile, '{}\n');
	const errors: ParseError[] = [];
	const settings = parse(settingsText, errors);
	if (errors.length || !settings || Array.isArray(settings) || typeof settings !== 'object') {
		throw new Error(`Fix invalid settings in ${settingsFile}, then rerun setup.`);
	}
	const runtimes: JavaRuntime[] = [];
	for (const entry of await (tooling === 'javascript' ? Promise.resolve([]) : readdir(javaCandidates, { withFileTypes: true }).catch(error => {
		if (!(error instanceof Error) || !hasErrorCode(error, 'ENOENT')) {
			throw error;
		}
		return [];
	}))) {
		const major = Number(entry.name.match(/^(\d+)[.-]/)?.[1]);
		const javaHome = path.join(javaCandidates, entry.name);
		if (major >= 8 && (await stat(path.join(javaHome, 'bin', 'javac')).catch(() => undefined))?.isFile()) {
			if (!runtimes.some(runtime => runtime.name === `JavaSE-${major}`)) {
				runtimes.push({ name: `JavaSE-${major}`, path: javaHome });
			}
		}
	}
	runtimes.sort((a, b) => Number(b.name.slice(7)) - Number(a.name.slice(7)));
	if (runtimes.length) {
		runtimes[0].default = true;
	}
	const defaults = { ...preferences.contributes.configurationDefaults, ...(runtimes.length ? { 'java.configuration.runtimes': runtimes } : {}) };
	for (const [key, value] of Object.entries(defaults)) {
		if (!Object.hasOwn(settings, key)) {
			settingsText = applyEdits(settingsText, modify(settingsText, [key], value, { formattingOptions: { insertSpaces: false, tabSize: 4 } }));
		} else if (key.startsWith('[') && typeof value === 'object' && !Array.isArray(value) && settings[key] && typeof settings[key] === 'object' && !Array.isArray(settings[key])) {
			// Language overrides are merged per setting. A previous setup may already
			// contain the block, and explicit user preferences must keep winning.
			for (const [setting, defaultValue] of Object.entries(value)) {
				if (!Object.hasOwn(settings[key], setting)) {
					settingsText = applyEdits(settingsText, modify(settingsText, [key, setting], defaultValue, { formattingOptions: { insertSpaces: false, tabSize: 4 } }));
				}
			}
		}
	}
	await writeFile(settingsFile, settingsText);
	const keybindingsFile = path.join(userDir, 'keybindings.json');
	const keybindingsText = await readOptional(keybindingsFile, '[]\n');
	const keybindingErrors: ParseError[] = [];
	const existingKeybindings: Keybinding[] = parse(keybindingsText, keybindingErrors);
	if (keybindingErrors.length || !Array.isArray(existingKeybindings)) {
		throw new Error(`Fix invalid keybindings in ${keybindingsFile}, then rerun setup.`);
	}
	// User bindings have higher precedence than installed keymaps. Insert our fixes
	// before existing user entries so an explicit user customization always wins.
	let bindingsText = keybindingsText;
	for (const binding of [...preferences.contributes.keybindings].reverse()) {
		const key = process.platform === 'darwin' ? binding.mac ?? binding.key : binding.key;
		if (!existingKeybindings.some(existing => existing.key === key && existing.command === binding.command)) {
			// Older profiles already contain our broad Go to Class binding. Place
			// the JS-specific override after it, while leaving later user choices last.
			const current: Keybinding[] = parse(bindingsText);
			const legacyClass = binding.command === 'workbench.action.showAllSymbols' && binding.when?.includes('editorLangId')
				? current.findIndex(existing => existing.key === key && existing.command === 'intellij.goToClass' && existing.when === '!terminalFocus && !inputFocus') : -1;
			bindingsText = applyEdits(bindingsText, modify(bindingsText, [legacyClass + 1], { key, command: binding.command, when: binding.when }, { isArrayInsertion: true, formattingOptions: { insertSpaces: false, tabSize: 4 } }));
		}
	}
	await writeFile(keybindingsFile, bindingsText);
	await writeFile(path.join(profile, 'tooling.json'), JSON.stringify({ profileVersion, tooling, installed, runtimes }, null, '\t') + '\n');
	return { profile, extensionsDir, userDataDir: path.join(profile, 'user-data'), installed, runtimes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({ options: { source: { type: 'string' }, profile: { type: 'string' }, tooling: { type: 'string', default: 'all' }, check: { type: 'boolean' }, help: { type: 'boolean' } } });
	if (values.help) {
		console.log('Usage: node scripts/intellij/setup.ts [--source ~/.vscode/extensions] [--profile .profile-oss/intellij] [--tooling all|java|javascript]\nCopies pinned tooling into a separate development profile. JavaScript includes ESLint and Prettier without requiring Java/Spring. Close that profile before rerunning.');
	} else {
		try {
			if (values.tooling !== 'all' && values.tooling !== 'java' && values.tooling !== 'javascript') {
				throw new Error('Choose --tooling all, java, or javascript.');
			}
			const profile = values.profile ?? path.join(root, '.profile-oss', values.tooling === 'all' ? 'intellij' : `intellij-${values.tooling}`);
			const versions = await readJSON<Record<string, string>>(new URL('./extensions.json', import.meta.url));
			if (values.check) {
				const saved = JSON.parse(await readOptional(path.join(profile, 'tooling.json'), '{}')) as { profileVersion?: number; tooling?: Tooling; installed?: { id: string; version: string }[] };
				process.exitCode = saved.profileVersion === profileVersion && saved.tooling === values.tooling && Object.entries(selectExtensions(versions, values.tooling)).every(([id, version]) => saved.installed?.some(installed => installed.id === id && installed.version === version)) ? 0 : 1;
			} else {
				const result = await setupIntelliJ({ source: values.source ?? path.join(homedir(), '.vscode', 'extensions'), profile, tooling: values.tooling, versions });
				console.log(JSON.stringify(result, null, '\t'));
			}
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
