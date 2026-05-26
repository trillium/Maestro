#!/usr/bin/env node
/**
 * Refresh OpenSpec Prompts
 *
 * Fetches the latest OpenSpec workflow prompts from the upstream repository
 * and writes them into src/prompts/openspec/.
 *
 * As of OpenSpec v1.x, the workflow prompts live in per-workflow TypeScript
 * modules at src/core/templates/workflows/*.ts, each exposing an
 * `instructions` template literal. We fetch those files and extract that
 * literal.
 *
 * Usage: npm run refresh-openspec
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENSPEC_DIR = path.join(__dirname, '..', 'src', 'prompts', 'openspec');
const METADATA_PATH = path.join(OPENSPEC_DIR, 'metadata.json');

// GitHub OpenSpec repository info
const GITHUB_API = 'https://api.github.com';
const REPO_OWNER = 'Fission-AI';
const REPO_NAME = 'OpenSpec';

// Map our local command IDs to the upstream workflow module filenames.
const UPSTREAM_WORKFLOWS = {
	proposal: 'new-change.ts',
	apply: 'apply-change.ts',
	archive: 'archive-change.ts',
};

function workflowUrl(ref, filename) {
	return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${ref}/src/core/templates/workflows/${filename}`;
}

/**
 * Make an HTTPS GET request
 */
function httpsGet(url, options = {}) {
	return new Promise((resolve, reject) => {
		const headers = {
			'User-Agent': 'Maestro-OpenSpec-Refresher',
			...options.headers,
		};

		https
			.get(url, { headers }, (res) => {
				// Handle redirects
				if (res.statusCode === 301 || res.statusCode === 302) {
					return resolve(httpsGet(res.headers.location, options));
				}

				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}: ${url}`));
					return;
				}

				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => resolve({ data, headers: res.headers }));
				res.on('error', reject);
			})
			.on('error', reject);
	});
}

/**
 * Extract the `instructions: \`...\`` template literal body from an upstream
 * workflow TypeScript module. Unescapes backslash-escaped chars (`\X` -> `X`)
 * — upstream currently uses this only for inline-code backticks.
 */
function extractInstructions(tsContent) {
	const match = tsContent.match(/instructions:\s*`((?:\\[\s\S]|[^`\\])*)`/);
	if (!match) return null;
	return match[1].replace(/\\([\s\S])/g, '$1');
}

/**
 * Get the latest release tag, falling back to `main`.
 */
async function getLatestRef() {
	try {
		const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
		const { data } = await httpsGet(url);
		const release = JSON.parse(data);
		return release.tag_name || 'main';
	} catch {
		console.warn('   Warning: Could not fetch latest release, using "main"');
		return 'main';
	}
}

/**
 * Main refresh function
 */
async function refreshOpenSpec() {
	console.log('🔄 Refreshing OpenSpec prompts from GitHub...\n');

	if (!fs.existsSync(OPENSPEC_DIR)) {
		console.error('❌ OpenSpec directory not found:', OPENSPEC_DIR);
		process.exit(1);
	}

	try {
		console.log('📋 Resolving latest release...');
		const ref = await getLatestRef();
		console.log(`   Ref: ${ref}`);

		console.log('\n✏️  Fetching workflow modules...');
		let updatedCount = 0;
		const failures = [];
		for (const [cmdId, filename] of Object.entries(UPSTREAM_WORKFLOWS)) {
			const url = workflowUrl(ref, filename);
			let tsContent;
			try {
				({ data: tsContent } = await httpsGet(url));
			} catch (e) {
				console.log(`   ⚠ Failed to fetch ${filename}: ${e.message}`);
				failures.push(filename);
				continue;
			}

			const instructions = extractInstructions(tsContent);
			if (!instructions) {
				console.log(`   ⚠ Could not extract instructions from ${filename}`);
				failures.push(filename);
				continue;
			}

			const promptFile = path.join(OPENSPEC_DIR, `openspec.${cmdId}.md`);
			const existing = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '';
			if (instructions !== existing) {
				fs.writeFileSync(promptFile, instructions);
				console.log(`   ✓ Updated: openspec.${cmdId}.md`);
				updatedCount++;
			} else {
				console.log(`   - Unchanged: openspec.${cmdId}.md`);
			}
		}

		if (updatedCount === 0 && failures.length === Object.keys(UPSTREAM_WORKFLOWS).length) {
			console.error('❌ Failed to fetch any workflow prompts');
			process.exit(1);
		}

		const metadata = {
			lastRefreshed: new Date().toISOString(),
			commitSha: ref,
			sourceVersion: ref.replace(/^v/, ''),
			sourceUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
		};

		fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
		console.log('\n📄 Updated metadata.json');

		console.log('\n✅ Refresh complete!');
		console.log(`   Ref: ${ref}`);
		console.log(`   Updated: ${updatedCount} files`);
		if (failures.length > 0) {
			console.log(`   Failed: ${failures.join(', ')}`);
		}
		console.log(`   Skipped: help, implement (custom Maestro prompts)`);
	} catch (error) {
		console.error('\n❌ Refresh failed:', error.message);
		process.exit(1);
	}
}

refreshOpenSpec();
