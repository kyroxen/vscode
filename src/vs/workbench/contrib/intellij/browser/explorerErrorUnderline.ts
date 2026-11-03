/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IExplorerFileContribution, explorerFileContribRegistry } from '../../files/browser/explorerFileContrib.js';

const enabledSetting = 'intellij.explorer.errorUnderlines.enabled';
const errorClass = 'intellij-explorer-error';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'intellij',
	properties: {
		[enabledSetting]: {
			type: 'boolean',
			default: true,
			description: localize('explorerErrorUnderlines', "Underline Explorer filenames with errors using a red wavy line. Filename colors and badges remain controlled by their existing settings.")
		}
	}
});

/** Adds an error cue without replacing native labels, Git decorations, or Explorer rendering. */
export class ExplorerErrorUnderline extends Disposable implements IExplorerFileContribution {
	private resource: URI | undefined;
	private readonly accessibility = this._register(new MutableDisposable());

	constructor(
		private readonly container: HTMLElement,
		@IMarkerService private readonly markerService: IMarkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUriIdentityService uriIdentityService: IUriIdentityService
	) {
		super();
		this._register(toDisposable(() => container.classList.remove(errorClass)));
		this._register(markerService.onMarkerChanged(resources => {
			if (this.resource && resources.some(resource => uriIdentityService.extUri.isEqual(resource, this.resource))) {
				this.update();
			}
		}));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(enabledSetting) || event.affectsConfiguration('problems.visibility')) {
				this.update();
			}
		}));
	}

	setResource(resource: URI | undefined): void {
		this.resource = resource;
		this.update();
	}

	private update(): void {
		if (this._store.isDisposed) {
			return;
		}
		const hasErrors = !!this.resource
			&& this.configurationService.getValue<boolean>(enabledSetting)
			&& this.configurationService.getValue<boolean>('problems.visibility') !== false
			&& this.markerService.read({ resource: this.resource, severities: MarkerSeverity.Error, take: 1 }).length > 0;
		this.container.classList.toggle(errorClass, hasErrors);
		this.accessibility.clear();
		const row = hasErrors ? this.container.closest('[role="treeitem"]') : null;
		if (row) {
			const previous = row.getAttribute('aria-description');
			const description = localize('explorerFileContainsErrors', "Contains errors");
			row.setAttribute('aria-description', description);
			this.accessibility.value = toDisposable(() => {
				if (row.getAttribute('aria-description') === description) {
					if (previous === null) {
						row.removeAttribute('aria-description');
					} else {
						row.setAttribute('aria-description', previous);
					}
				}
			});
		}
	}
}

explorerFileContribRegistry.register({
	create: (instantiationService, container) => instantiationService.createInstance(ExplorerErrorUnderline, container)
});
