/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../../base/common/resources.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { localize } from '../../../../../nls.js';
import { Range } from '../../../../common/core/range.js';
import { Position } from '../../../../common/core/position.js';
import { StandardTokenType } from '../../../../common/encodedTokenAttributes.js';
import { getStandardTokenTypeAtPosition } from '../../../../common/tokens/lineTokens.js';
import { LocationLink, ProviderResult } from '../../../../common/languages.js';
import { ITextModel } from '../../../../common/model.js';
import { ILanguageFeaturesService } from '../../../../common/services/languageFeatures.js';
import { OneReference } from '../referencesModel.js';

export type ReferenceCategory = 'implementations' | 'usages' | 'tests' | 'documentation' | 'declarations' | 'imports' | 'resources' | 'other';

export const referenceCategoryOrder: readonly ReferenceCategory[] = ['implementations', 'usages', 'tests', 'documentation', 'declarations', 'imports', 'resources', 'other'];

/** Classification needs a completeness flag: failed provider calls cannot imply normal usages. */
export async function referenceClassificationTargets(features: ILanguageFeaturesService, model: ITextModel, position: Position, token: CancellationToken, onTargets?: (targets: LocationLink[], category: 'declarations' | 'implementations') => void) {
	const collect = async (queries: (() => ProviderResult<LocationLink | LocationLink[]>)[], category: 'declarations' | 'implementations') => {
		const results = await Promise.allSettled(queries.map(async query => {
			const value = await query();
			const targets = value ? (Array.isArray(value) ? value : [value]) : [];
			if (!token.isCancellationRequested) {
				onTargets?.(targets, category);
			}
			return value;
		}));
		return {
			complete: queries.length > 0 && results.every(result => result.status === 'fulfilled'),
			targets: results.flatMap(result => result.status === 'fulfilled' && result.value ? (Array.isArray(result.value) ? result.value : [result.value]) : [])
		};
	};
	const [definitions, implementations] = await Promise.all([
		collect(features.definitionProvider.ordered(model).map(provider => () => provider.provideDefinition(model, position, token)), 'declarations'),
		collect(features.implementationProvider.ordered(model).map(provider => () => provider.provideImplementation(model, position, token)), 'implementations')
	]);
	return { definitions: definitions.targets, implementations: implementations.targets, complete: definitions.complete && implementations.complete };
}

export function referenceCategoryLabel(category: ReferenceCategory): string {
	switch (category) {
		case 'implementations': return localize('implementations', "Implementations");
		case 'usages': return localize('productionUsages', "Production Usages");
		case 'tests': return localize('testUsages', "Test Usages");
		case 'documentation': return localize('documentationReferences', "Documentation References");
		case 'declarations': return localize('declarations', "Declarations");
		case 'imports': return localize('imports', "Imports");
		case 'resources': return localize('resourceReferences', "Configuration / Resource References");
		case 'other': return localize('otherReferences', "Other References");
	}
}

/** Java lexical states prevent comment markers inside strings/text blocks becoming documentation. */
export function javaDocumentationRanges(source: string): { start: number; end: number }[] {
	const result: { start: number; end: number }[] = [];
	let state: 'code' | 'string' | 'char' | 'textBlock' | 'lineComment' | 'blockComment' = 'code';
	let documentationStart = -1;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		const next = source[index + 1];
		if (state === 'code') {
			if (char === '/' && next === '/') {
				state = 'lineComment';
				index++;
			} else if (char === '/' && next === '*') {
				state = 'blockComment';
				documentationStart = source[index + 2] === '*' ? index : -1;
				index++; // Leave the second '*' available so an empty /**/ also closes.
			} else if (char === '"' && source.startsWith('"""', index)) {
				state = 'textBlock';
				index += 2;
			} else if (char === '"') {
				state = 'string';
			} else if (char === '\'') {
				state = 'char';
			}
		} else if (state === 'lineComment') {
			if (char === '\n' || char === '\r') {
				state = 'code';
			}
		} else if (state === 'blockComment') {
			if (char === '*' && next === '/') {
				if (documentationStart >= 0) {
					result.push({ start: documentationStart, end: index + 2 });
				}
				documentationStart = -1;
				state = 'code';
				index++;
			}
		} else if (char === '\\') {
			index++;
		} else if (state === 'textBlock') {
			if (source.startsWith('"""', index)) {
				state = 'code';
				index += 2;
			}
		} else if ((state === 'string' && char === '"') || (state === 'char' && char === '\'')) {
			state = 'code';
		}
	}
	if (state === 'blockComment' && documentationStart >= 0) {
		result.push({ start: documentationStart, end: source.length });
	}
	return result;
}

/** Reuse language tokenization so JSDoc-looking strings, regexes, and JSX stay code. */
export function documentationRanges(model: ITextModel): { start: number; end: number }[] {
	if (model.getLanguageId() === 'java' || /\.java$/i.test(model.uri.path)) {
		return javaDocumentationRanges(model.getValue());
	}
	if (!/^(?:javascript|javascriptreact|typescript|typescriptreact)$/.test(model.getLanguageId())) {
		return [];
	}
	const result: { start: number; end: number }[] = [];
	const text = model.getValue();
	for (const match of text.matchAll(/\/\*\*/g)) {
		const start = match.index;
		const position = model.getPositionAt(start);
		if (position.lineNumber > 1) {
			const previous = model.getLineContent(position.lineNumber - 1);
			const previousPosition = { lineNumber: position.lineNumber - 1, column: Math.max(1, previous.length) };
			if (getStandardTokenTypeAtPosition(model, previousPosition) === StandardTokenType.Comment && !previous.trimEnd().endsWith('*/')) {
				const tokens = model.tokenization.getLineTokens(previousPosition.lineNumber);
				const token = tokens.findTokenIndexAtOffset(previousPosition.column - 1);
				if (!previous.slice(tokens.getStartOffset(token)).startsWith('//')) {
					continue; // Still inside an existing block comment.
				}
			}
		}
		if (getStandardTokenTypeAtPosition(model, position) === StandardTokenType.Comment) {
			const line = model.getLineContent(position.lineNumber);
			const tokens = model.tokenization.getLineTokens(position.lineNumber);
			const token = tokens.findTokenIndexAtOffset(position.column - 1);
			// An apparent opener inside an ordinary comment is not a JSDoc block.
			if (tokens.getStartOffset(token) === position.column - 1 && line.startsWith('/**', position.column - 1)) {
				const end = text.indexOf('*/', start + 2);
				result.push({ start, end: end < 0 ? text.length : end + 2 });
			}
		}
	}
	return result;
}

function isImportReference(reference: OneReference, source: ITextModel): boolean {
	const lineNumber = reference.range.startLineNumber;
	const line = source.getLineContent(lineNumber);
	const semicolon = line.indexOf(';');
	if (semicolon >= 0 && reference.range.startColumn - 1 > semicolon) {
		return false;
	}
	if (/^\s*import\s+/.test(line)) {
		return true;
	}
	if (!/\.(?:[cm]?[jt]sx?)$/i.test(reference.uri.path)) {
		return false;
	}
	// Only classify the binding/module part of a single statement. Usage later on
	// the same line must not become an import merely because require() precedes it.
	const commonJS = /^\s*(?:const|let|var)\s+[^;]+?=\s*require\s*\([^)]*\)/.exec(line);
	if (commonJS && reference.range.endColumn - 1 <= commonJS[0].length) {
		return true;
	}
	if (/^\s*export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]/.test(line)) {
		return true;
	}
	// Named multiline imports/re-exports are bounded by their braces; avoid
	// searching through unrelated statements or guessing from identifier names.
	let statement = '';
	for (let previous = lineNumber; previous >= Math.max(1, lineNumber - 30); previous--) {
		const previousLine = source.getLineContent(previous);
		statement = statement ? `${previousLine}\n${statement}` : previousLine;
		if (/^\s*(?:import|export)\s*\{/.test(statement)) {
			for (let next = lineNumber + 1; next <= Math.min(source.getLineCount(), lineNumber + 30) && !statement.includes('}'); next++) {
				statement += `\n${source.getLineContent(next)}`;
			}
			return /^\s*(?:import|export)\s*\{[^}]*\}\s*from\s*['"]/.test(statement);
		}
		if (/[;}]/.test(previousLine)) {
			break;
		}
	}
	return false;
}

function isTarget(reference: OneReference, targets: readonly LocationLink[]): boolean {
	return targets.some(target => {
		const selection = target.targetSelectionRange ?? target.range;
		// Whole-method ranges must not classify recursive calls in the body as declarations.
		return isEqual(reference.uri, target.uri) && selection.startLineNumber === reference.range.startLineNumber && Range.areIntersecting(selection, reference.range);
	});
}

export function classifyReference(reference: OneReference, source: ITextModel | undefined, documentation: readonly { start: number; end: number }[], definitions: readonly LocationLink[], implementations: readonly LocationLink[], hasSymbolMetadata: boolean): ReferenceCategory {
	if (isTarget(reference, implementations)) {
		return 'implementations';
	}
	if (isTarget(reference, definitions)) {
		return 'declarations';
	}
	const path = reference.uri.path;
	if (/\.(?:xml|ya?ml|properties|jsonc?|toml|conf|ini)$/i.test(path)) {
		return 'resources';
	}
	if (!source || reference.range.startLineNumber > source.getLineCount()) {
		return 'other';
	}
	const offset = source.getOffsetAt({ lineNumber: reference.range.startLineNumber, column: reference.range.startColumn });
	if (/\.(?:md|mdx|rst|adoc)$/i.test(path) || documentation.some(range => range.start <= offset && offset < range.end)) {
		return 'documentation';
	}
	if (isImportReference(reference, source)) {
		return 'imports';
	}
	// Conventional source roots and names are evidence, not a full build-system test model.
	if (/(?:^|\/)(?:test|tests|__tests__|src\/test[^/]*|src\/integrationTest|src\/functionalTest|src\/e2e)(?:\/|$)/i.test(path)
		|| /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)
		|| /(?:^|\/)(?:Test[^/]*|[^/]*(?:Test|Tests|IT|ITCase|Spec))\.java$/.test(path)) {
		return 'tests';
	}
	return hasSymbolMetadata ? 'usages' : 'other';
}
