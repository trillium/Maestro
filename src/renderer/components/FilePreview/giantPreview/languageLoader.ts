import type { Extension } from '@codemirror/state';

/**
 * Lazy per-language extension loader for the Giant tier.
 *
 * Each `@codemirror/lang-*` package weighs 10-30 KB gz. Dynamic `import()`
 * means the only language pack that ever enters the bundle is the one the
 * user actually opens. Unknown languages get plain text — still useful for
 * huge files since CM6 handles them with line numbers and search.
 *
 * Returns `null` when the language is unrecognized or when the dynamic
 * import fails (network / packaging issue). The caller mounts the editor
 * without a language extension in that case.
 */
export async function loadLanguageExtension(language: string): Promise<Extension | null> {
	const normalized = language.toLowerCase();

	switch (normalized) {
		case 'markdown':
		case 'md':
		case 'mdx': {
			const { markdown } = await import('@codemirror/lang-markdown');
			return markdown();
		}
		case 'javascript':
		case 'js':
		case 'jsx': {
			const { javascript } = await import('@codemirror/lang-javascript');
			return javascript({ jsx: normalized === 'jsx' });
		}
		case 'typescript':
		case 'ts':
		case 'tsx': {
			const { javascript } = await import('@codemirror/lang-javascript');
			return javascript({ typescript: true, jsx: normalized === 'tsx' });
		}
		case 'python':
		case 'py': {
			const { python } = await import('@codemirror/lang-python');
			return python();
		}
		case 'json':
		case 'jsonl':
		case 'ndjson': {
			const { json } = await import('@codemirror/lang-json');
			return json();
		}
		case 'yaml':
		case 'yml': {
			const { yaml } = await import('@codemirror/lang-yaml');
			return yaml();
		}
		default:
			return null;
	}
}

/**
 * Predicate companion to `loadLanguageExtension`: true when we have a
 * dedicated CM6 language pack for the given identifier. Used by the
 * component to decide whether to await the loader at all (skipping it for
 * plain text saves a microtask).
 */
export function hasLanguageSupport(language: string): boolean {
	const normalized = language.toLowerCase();
	return (
		[
			'markdown',
			'md',
			'mdx',
			'javascript',
			'js',
			'jsx',
			'typescript',
			'ts',
			'tsx',
			'python',
			'py',
			'json',
			'jsonl',
			'ndjson',
			'yaml',
			'yml',
		].indexOf(normalized) !== -1
	);
}
