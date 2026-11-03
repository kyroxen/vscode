/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Mocha from 'mocha';

/** Entry point for --extensionTestsPath=extensions/intellij-javascript/out/test. */
export function run(): Promise<void> {
	const mocha = new Mocha({ ui: 'tdd' });
	mocha.addFile(require.resolve('./project.test'));
	mocha.addFile(require.resolve('./tasks.test'));
	return new Promise((resolve, reject) => mocha.run(failures => failures ? reject(new Error(`${failures} JavaScript project tests failed`)) : resolve()));
}
