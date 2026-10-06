'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
	{ ignores: ['node_modules/**', 'public/**', 'cache/**', 'raw/**'] },
	js.configs.recommended,
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				...globals.commonjs,

				// set up by app.js at startup and used without the "global." prefix
				coinConfig: 'readonly',
				SATS_PER_BTC: 'readonly'
			}
		},
		rules: {
			// these are real findings but too widespread to fail the build on yet: fix them as the code is touched
			'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
			'no-async-promise-executor': 'warn',
			'no-prototype-builtins': 'warn',

			'no-constant-condition': ['error', { checkLoops: false }],
			'no-empty': ['error', { allowEmptyCatch: true }]
		}
	}
];
