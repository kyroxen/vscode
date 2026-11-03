/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
const languageConfigPattern = /^(?:js|ts)config(?:\.[\w-]+)*\.json$/;

export interface ProjectDirectory {
	readonly uri: string;
	readonly files: readonly string[];
	readonly manifest?: string;
}

export interface ProjectTool {
	readonly name: string;
	readonly extension: string;
}

export interface JavaScriptProject {
	readonly directory: string;
	readonly name?: string;
	readonly language: 'JavaScript' | 'TypeScript';
	readonly manager: PackageManager;
	readonly framework?: string;
	readonly tools: readonly ProjectTool[];
	readonly scripts: readonly string[];
	readonly config?: string;
}

interface PackageManifest {
	name?: string;
	packageManager?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	eslintConfig?: object;
	prettier?: object | string;
}

function readManifest(directory: ProjectDirectory): PackageManifest {
	if (directory.manifest === undefined) {
		return {};
	}
	const value = JSON.parse(directory.manifest.replace(/^\uFEFF/, '')) as PackageManifest | null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid package.json: ${directory.uri}`);
	}
	return value;
}

/** Directories are ordered from workspace root to the active file's parent. No config code executes. */
export function describeProject(directories: readonly ProjectDirectory[]): JavaScriptProject | undefined {
	const manifests = directories.map(directory => readManifest(directory));
	let projectIndex = -1;
	for (let index = 0; index < directories.length; index++) {
		if (directories[index].files.some(file => file === 'package.json' || languageConfigPattern.test(file))) {
			projectIndex = index;
		}
	}
	if (projectIndex < 0) {
		return undefined;
	}
	// A nested tsconfig belongs to its enclosing package, whose scripts/name we retain.
	let packageIndex = projectIndex;
	while (packageIndex >= 0 && !directories[packageIndex].files.includes('package.json')) {
		packageIndex--;
	}
	const project = directories[packageIndex >= 0 ? packageIndex : projectIndex];
	const manifest = manifests[packageIndex >= 0 ? packageIndex : projectIndex];
	const scopes = directories;
	const dependencies = new Set(scopes.flatMap((_, index) => {
		const item = manifests[index];
		return [item.dependencies, item.devDependencies, item.peerDependencies].flatMap(deps => deps && typeof deps === 'object' && !Array.isArray(deps) ? Object.keys(deps) : []);
	}));
	const files = scopes.flatMap(scope => scope.files);
	let manager: PackageManager | undefined;
	let config: string | undefined;
	for (let index = scopes.length - 1; index >= 0; index--) {
		const scope = scopes[index];
		const declared = typeof manifests[index].packageManager === 'string' ? manifests[index].packageManager?.split('@')[0] : undefined;
		const declaredManager = declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun' ? declared : undefined;
		manager ??= declaredManager ?? (scope.files.includes('pnpm-lock.yaml') ? 'pnpm' : scope.files.includes('yarn.lock') ? 'yarn' : scope.files.some(file => file === 'bun.lock' || file === 'bun.lockb') ? 'bun' : scope.files.some(file => file === 'package-lock.json' || file === 'npm-shrinkwrap.json') ? 'npm' : undefined);
		config ??= scope.files.includes('tsconfig.json') ? `${scope.uri}/tsconfig.json` : scope.files.includes('jsconfig.json') ? `${scope.uri}/jsconfig.json` : undefined;
	}
	const tools: ProjectTool[] = [];
	if (dependencies.has('eslint') || files.some(file => /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\..+)?)$/.test(file)) || manifests.some(item => item.eslintConfig)) {
		tools.push({ name: 'ESLint', extension: 'dbaeumer.vscode-eslint' });
	}
	if (dependencies.has('prettier') || files.some(file => /^(?:prettier\.config\.[cm]?[jt]s|\.prettierrc(?:\..+)?)$/.test(file)) || manifests.some(item => item.prettier)) {
		tools.push({ name: 'Prettier', extension: 'esbenp.prettier-vscode' });
	}
	if (dependencies.has('@biomejs/biome') || files.some(file => /^biome\.jsonc?$/.test(file))) {
		tools.push({ name: 'Biome', extension: 'biomejs.biome' });
	}
	if (dependencies.has('vitest')) {
		tools.push({ name: 'Vitest', extension: 'vitest.explorer' });
	}
	if (dependencies.has('jest')) {
		tools.push({ name: 'Jest', extension: 'orta.vscode-jest' });
	}
	const frameworks = [['next', 'Next.js'], ['@angular/core', 'Angular'], ['astro', 'Astro'], ['svelte', 'Svelte'], ['vue', 'Vue'], ['react', 'React']] as const;
	const packageDependencies = new Set([manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].flatMap(deps => deps && typeof deps === 'object' && !Array.isArray(deps) ? Object.keys(deps) : []));
	const framework = frameworks.find(([dependency]) => packageDependencies.has(dependency))?.[1];
	const frameworkTools: Record<string, ProjectTool> = {
		Vue: { name: 'Vue', extension: 'Vue.volar' },
		Svelte: { name: 'Svelte', extension: 'svelte.svelte-vscode' },
		Angular: { name: 'Angular', extension: 'Angular.ng-template' },
		Astro: { name: 'Astro', extension: 'astro-build.astro-vscode' }
	};
	if (framework && frameworkTools[framework]) {
		tools.push(frameworkTools[framework]);
	}
	const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts) ? Object.keys(manifest.scripts).filter(name => typeof manifest.scripts?.[name] === 'string') : [];
	return {
		directory: project.uri,
		name: typeof manifest.name === 'string' ? manifest.name : undefined,
		language: files.some(file => languageConfigPattern.test(file) && file.startsWith('tsconfig')) ? 'TypeScript' : 'JavaScript',
		manager: manager ?? 'npm', framework, tools, scripts, config
	};
}
