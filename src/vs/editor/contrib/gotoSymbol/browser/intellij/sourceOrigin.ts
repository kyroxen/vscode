/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';

export interface SourceOrigin {
	readonly kind: 'workspace' | 'library' | 'jdk' | 'file' | 'external';
	readonly label: string;
	readonly detail?: string;
	readonly packageName?: string;
	readonly description: string;
}

/** Describe the resource's origin without assuming library sources were decompiled. */
export function sourceOrigin(resource: URI, inWorkspace = false): SourceOrigin {
	const segments = resource.path.split('/').filter(Boolean);
	const archive = segments[0] ?? '';
	const isJava = resource.scheme === 'jdt' || resource.scheme === 'jrt';
	const isJdk = resource.scheme === 'jrt' || (isJava && (/^(?:java|jdk)\.[\w.]+$/.test(archive) || archive === 'rt.jar'));
	const isLibrary = isJava && !isJdk && /\.jar$/i.test(archive);
	const kind = isJdk ? 'jdk' : isLibrary ? 'library' : inWorkspace ? 'workspace' : resource.scheme === 'file' ? 'file' : 'external';
	const label = kind === 'jdk' ? localize('jdkSource', "JDK")
		: kind === 'library' ? localize('librarySource', "Library")
			: kind === 'workspace' ? localize('workspaceSource', "Workspace")
				: kind === 'file' ? localize('fileSource', "File") : localize('externalSource', "External");
	const artifact = isLibrary ? archive.replace(/\.jar$/i, '') : undefined;
	const version = artifact?.match(/^(?<name>.+?)-(?<version>\d.*)$/)?.groups;
	const detail = version ? `${version.name} · ${version.version}` : artifact ?? (isJdk ? archive : undefined);
	const packageName = isJava && segments.length > 2 ? segments.slice(1, -1).join('.') : undefined;
	return { kind, label, detail, packageName, description: [label, detail, packageName, resource.path].filter(Boolean).join('\n') };
}
