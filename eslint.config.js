'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
	{ ignores: ['node_modules/**', 'public/**', 'cache/**', 'raw/**', 'dist/**'] },
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
			// these are real findings but too widespread to fix everywhere yet: fix them as the code is touched
			'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
			'no-async-promise-executor': 'warn',
			'no-prototype-builtins': 'warn',

			'no-constant-condition': ['error', { checkLoops: false }],
			'no-empty': ['error', { allowEmptyCatch: true }]
		}
	},

	// TypeScript files: typescript-eslint's recommended rules (which switch off the rules the compiler covers)
	...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts'] })),
	{
		files: ['**/*.ts'],
		languageOptions: { globals: { ...globals.node } }
	},

	// declaration files describe the explorer's globals, which need var and loose types
	{
		files: ['types/**/*.d.ts'],
		rules: {
			'no-var': 'off',
			'@typescript-eslint/no-explicit-any': 'off'
		}
	}
];
