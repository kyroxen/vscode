/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Range } from '../../../../common/core/range.js';
import { LocationLink } from '../../../../common/languages.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { ReferencesModel } from '../../browser/referencesModel.js';
import { classifyReference, javaDocumentationRanges } from '../../browser/intellij/referenceCategories.js';

suite('IntelliJ Reference Categories', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function reference(path: string, range: Range) {
		return store.add(new ReferencesModel([{ uri: URI.file(path), range }], 'References')).references[0];
	}

	test('separates implementations, declarations, production, tests, documentation, imports, and resources', () => {
		const cases = [
			{ path: '/src/ServiceImpl.java', text: 'void call() {}', category: 'implementations' },
			{ path: '/src/Service.java', text: 'void call();', category: 'declarations' },
			{ path: '/src/Controller.java', text: 'service.call();', category: 'usages' },
			{ path: '/src/test/java/Controller.java', text: 'service.call();', category: 'tests' },
			{ path: '/src/integrationTest/java/Fixture.java', text: 'service.call();', category: 'tests' },
			{ path: '/custom/ServiceTest.java', text: 'service.call();', category: 'tests' },
			{ path: '/src/Controller.java', text: '/** {@link Service#call()} */', category: 'documentation' },
			{ path: '/src/Import.java', text: 'import static pkg.Service.call;', category: 'imports' },
			{ path: '/src/main/resources/application.yml', text: 'bean: call', category: 'resources' },
			{ path: '/docs/README.md', text: 'See call', category: 'documentation' }
		];
		const actual = cases.map(item => {
			const column = item.text.indexOf('call') + 1;
			const range = new Range(1, column, 1, column + 4);
			const ref = reference(item.path, range);
			const source = store.add(createTextModel(item.text, undefined, undefined, ref.uri));
			const location: LocationLink = { uri: ref.uri, range };
			return classifyReference(ref, source, javaDocumentationRanges(item.text), item.category === 'declarations' ? [location] : [], item.category === 'implementations' ? [location] : [], true);
		});
		assert.deepStrictEqual(actual, cases.map(item => item.category));
	});

	test('preserves semantic implementations in test sources and prevents broad method ranges from swallowing recursive calls', () => {
		const uri = URI.file('/src/test/java/ServiceTest.java');
		const implementation: LocationLink = { uri, range: new Range(1, 1, 3, 2), targetSelectionRange: new Range(1, 6, 1, 10) };
		const source = store.add(createTextModel('void call() {\n    call();\n}', undefined, undefined, uri));
		assert.deepStrictEqual([
			classifyReference(reference(uri.path, new Range(1, 6, 1, 10)), source, [], [], [implementation], true),
			classifyReference(reference(uri.path, new Range(2, 5, 2, 9)), source, [], [], [implementation], true)
		], ['implementations', 'tests']);
	});

	test('keeps unknown sources or unavailable symbol metadata out of production usages', () => {
		const ref = reference('/src/Controller.java', new Range(1, 1, 1, 5));
		const source = store.add(createTextModel('call();', undefined, undefined, ref.uri));
		assert.deepStrictEqual([
			classifyReference(ref, undefined, [], [], [], true),
			classifyReference(ref, source, [], [], [], false)
		], ['other', 'other']);
	});

	test('Java documentation detection ignores strings, character literals, text blocks, and ordinary comments', () => {
		const source = ['String s = "/** fake */";', 'char slash = \'/\';', 'String block = """', '/** fake */', '""";', '// /** fake */', '/* ordinary */', '/** real */', '/**/', '/** unfinished'].join('\n');
		assert.deepStrictEqual(javaDocumentationRanges(source).map(range => source.slice(range.start, range.end)), ['/** real */', '/**/', '/** unfinished']);
	});
});
