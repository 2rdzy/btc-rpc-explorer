'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
	{ ignores: ['node_modules/**', 'public/**', 'cache/**', 'raw/**', 'dist/**', '.test-build/**'] },
	js.configs.recommended,
	// the only JavaScript is this file (test/no-javascript.test.ts keeps it that way)
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				...globals.commonjs
			}
		},
		rules: {
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
