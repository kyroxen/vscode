/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationDefaults, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ISearchService, QueryType } from '../../../services/search/common/search.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';

const enabledSetting = 'intellij.projectAppearance.enabled';
const javaAppearance = {
	'workbench.colorTheme': 'IntelliJ Islands Dark',
	'workbench.iconTheme': 'vsc-jetbrains-icons-enhanced'
};

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'intellij',
	title: localize('intellijAppearance', "IntelliJ Project Appearance"),
	properties: {
		[enabledSetting]: {
			type: 'boolean',
			default: true,
			description: localize('automaticAppearance', "Use IntelliJ appearance defaults in Java workspaces. Explicit theme and file icon settings take precedence. JavaScript, TypeScript, and other workspaces retain the general defaults.")
		}
	}
});

/** Window-local defaults let native configuration precedence and theme handling remain authoritative. */
export class ProjectAppearanceContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.intellijProjectAppearance';
	private readonly search = this._register(new MutableDisposable());
	private appliedDefaults: IConfigurationDefaults | undefined;
	private readonly scheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 200));
	private revision = 0;

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISearchService private readonly searchService: ISearchService,
		@IFileService fileService: IFileService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(toDisposable(() => this.applyDefaults(undefined)));
		this._register(workspaceService.onDidChangeWorkspaceFolders(() => this.schedule()));
		// Reuse the workbench's workspace watches; edits to existing file contents do not change classification.
		this._register(fileService.onDidFilesChange(event => {
			if (workspaceService.getWorkspace().folders.some(folder => event.affects(folder.uri, FileChangeType.ADDED, FileChangeType.DELETED))) {
				this.schedule();
			}
		}));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(enabledSetting)) {
				this.schedule();
			}
		}));
		this._register(extensionService.onDidChangeExtensions(() => this.schedule()));
		void this.refresh();
	}

	private schedule(): void {
		this.revision++;
		this.search.clear();
		this.scheduler.schedule();
	}

	/** Recompute after project topology, extension availability, or opt-out changes. */
	async refresh(): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		this.scheduler.cancel();
		const revision = ++this.revision;
		this.search.clear();
		const tokenSource = new CancellationTokenSource();
		this.search.value = toDisposable(() => tokenSource.dispose(true));
		const current = () => !tokenSource.token.isCancellationRequested && revision === this.revision;
		try {
			// Extension defaults must be registered before adding our window-specific defaults.
			await this.extensionService.whenInstalledExtensionsRegistered();
			if (!current()) {
				return;
			}
			const folders = this.workspaceService.getWorkspace().folders;
			let overrides: Record<string, string> | undefined;
			if (this.configurationService.getValue<boolean>(enabledSetting) && folders.length) {
				// JS/TS and unrecognized workspaces already use the shared general defaults.
				// Build markers detect nested modules; source-only projects use conventional roots
				// so isolated syntax fixtures in a JS repository do not select Java appearance.
				const result = await this.searchService.fileSearch({
					type: QueryType.File,
					folderQueries: folders.map(folder => ({ folder: folder.uri })),
					includePattern: {
						'**/{pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts}': true,
						'*.java': true,
						'src/**/*.java': true,
						'**/src/{main,test}/java/**/*.java': true
					},
					excludePattern: { '**/{node_modules,.git,target,build,dist,coverage,.next,.gradle,out,bin}/**': true },
					exists: true,
					maxResults: 1,
					_reason: 'intellijProjectAppearance'
				}, tokenSource.token);
				if (result.limitHit || result.results.length) {
					const [colors, icons] = await Promise.all([this.themeService.getColorThemes(), this.themeService.getFileIconThemes()]);
					overrides = {};
					if (colors.some(theme => theme.settingsId === javaAppearance['workbench.colorTheme'])) {
						overrides['workbench.colorTheme'] = javaAppearance['workbench.colorTheme'];
					}
					if (icons.some(theme => theme.settingsId === javaAppearance['workbench.iconTheme'])) {
						overrides['workbench.iconTheme'] = javaAppearance['workbench.iconTheme'];
					}
				}
			}
			if (!current()) {
				return;
			}
			this.applyDefaults(overrides);
		} catch (error) {
			if (current() && !isCancellationError(error)) {
				this.applyDefaults(undefined);
				this.logService.warn('Unable to detect IntelliJ project appearance', error);
			}
		}
	}

	private applyDefaults(overrides: Record<string, string> | undefined): void {
		if (overrides && !Object.keys(overrides).length) {
			overrides = undefined;
		}
		if (equals(this.appliedDefaults?.overrides, overrides)) {
			return;
		}
		const defaults: IConfigurationDefaults | undefined = overrides ? {
			overrides,
			source: { id: ProjectAppearanceContribution.ID, displayName: localize('projectAppearanceDefaults', "Project Appearance") }
		} : undefined;
		Registry.as<IConfigurationRegistry>(Extensions.Configuration).deltaConfiguration({
			removedDefaults: this.appliedDefaults ? [this.appliedDefaults] : [],
			addedDefaults: defaults ? [defaults] : []
		});
		this.appliedDefaults = defaults;
	}
}
