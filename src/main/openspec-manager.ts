/**
 * OpenSpec Manager
 *
 * Manages bundled OpenSpec prompts with support for:
 * - Loading bundled prompts from src/prompts/openspec/
 * - Fetching updates from GitHub's OpenSpec repository
 * - User customization with ability to reset to defaults
 *
 * OpenSpec provides a structured change management workflow:
 * - Proposal → Draft change specifications before coding
 * - Apply → Implement tasks referencing agreed specs
 * - Archive → Move completed work to archive after deployment
 *
 * Source: https://github.com/Fission-AI/OpenSpec
 */

import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { logger } from './utils/logger';

const LOG_CONTEXT = '[OpenSpec]';

// All bundled OpenSpec commands with their metadata
const OPENSPEC_COMMANDS = [
	{
		id: 'help',
		command: '/openspec.help',
		description: 'Learn how to use OpenSpec with Maestro',
		isCustom: true,
	},
	{
		id: 'proposal',
		command: '/openspec.proposal',
		description: 'Create a change proposal with specs, tasks, and optional design docs',
		isCustom: false,
	},
	{
		id: 'apply',
		command: '/openspec.apply',
		description: 'Implement an approved change proposal by executing tasks',
		isCustom: false,
	},
	{
		id: 'archive',
		command: '/openspec.archive',
		description: 'Archive a completed change after deployment',
		isCustom: false,
	},
	{
		id: 'implement',
		command: '/openspec.implement',
		description: 'Convert OpenSpec tasks to Maestro Auto Run documents',
		isCustom: true,
	},
] as const;

export interface OpenSpecCommand {
	id: string;
	command: string;
	description: string;
	prompt: string;
	isCustom: boolean;
	isModified: boolean;
}

export interface OpenSpecMetadata {
	lastRefreshed: string;
	commitSha: string;
	sourceVersion: string;
	sourceUrl: string;
}

interface StoredPrompt {
	content: string;
	isModified: boolean;
	modifiedAt?: string;
}

interface StoredData {
	metadata: OpenSpecMetadata;
	prompts: Record<string, StoredPrompt>;
}

/**
 * Get path to user's OpenSpec customizations file
 */
function getUserDataPath(): string {
	return path.join(app.getPath('userData'), 'openspec-customizations.json');
}

/**
 * Load user customizations from disk
 */
async function loadUserCustomizations(): Promise<StoredData | null> {
	try {
		const content = await fs.readFile(getUserDataPath(), 'utf-8');
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Save user customizations to disk
 */
async function saveUserCustomizations(data: StoredData): Promise<void> {
	await fs.writeFile(getUserDataPath(), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get the path to bundled prompts directory
 * In development, this is src/prompts/openspec
 * In production, this is in the app resources
 */
function getBundledPromptsPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'prompts', 'openspec');
	}
	// In development, use the source directory
	return path.join(__dirname, '..', '..', 'src', 'prompts', 'openspec');
}

/**
 * Get the user data directory for storing downloaded OpenSpec prompts
 */
function getUserPromptsPath(): string {
	return path.join(app.getPath('userData'), 'openspec-prompts');
}

/**
 * Get bundled prompts by reading from disk
 * Checks user prompts directory first (for downloaded updates), then falls back to bundled
 */
async function getBundledPrompts(): Promise<
	Record<string, { prompt: string; description: string; isCustom: boolean }>
> {
	const bundledPromptsDir = getBundledPromptsPath();
	const userPromptsDir = getUserPromptsPath();
	const result: Record<string, { prompt: string; description: string; isCustom: boolean }> = {};

	for (const cmd of OPENSPEC_COMMANDS) {
		// For custom commands, always use bundled
		if (cmd.isCustom) {
			try {
				const promptPath = path.join(bundledPromptsDir, `openspec.${cmd.id}.md`);
				const prompt = await fs.readFile(promptPath, 'utf-8');
				result[cmd.id] = {
					prompt,
					description: cmd.description,
					isCustom: cmd.isCustom,
				};
			} catch (error) {
				logger.warn(`Failed to load bundled prompt for ${cmd.id}: ${error}`, LOG_CONTEXT);
				result[cmd.id] = {
					prompt: `# ${cmd.id}\n\nPrompt not available.`,
					description: cmd.description,
					isCustom: cmd.isCustom,
				};
			}
			continue;
		}

		// For upstream commands, check user prompts directory first (downloaded updates)
		try {
			const userPromptPath = path.join(userPromptsDir, `openspec.${cmd.id}.md`);
			const prompt = await fs.readFile(userPromptPath, 'utf-8');
			result[cmd.id] = {
				prompt,
				description: cmd.description,
				isCustom: cmd.isCustom,
			};
			continue;
		} catch {
			// User prompt not found, try bundled
		}

		// Fall back to bundled prompts
		try {
			const promptPath = path.join(bundledPromptsDir, `openspec.${cmd.id}.md`);
			const prompt = await fs.readFile(promptPath, 'utf-8');
			result[cmd.id] = {
				prompt,
				description: cmd.description,
				isCustom: cmd.isCustom,
			};
		} catch (error) {
			logger.warn(`Failed to load bundled prompt for ${cmd.id}: ${error}`, LOG_CONTEXT);
			result[cmd.id] = {
				prompt: `# ${cmd.id}\n\nPrompt not available.`,
				description: cmd.description,
				isCustom: cmd.isCustom,
			};
		}
	}

	return result;
}

/**
 * Get bundled metadata by reading from disk
 * Checks user prompts directory first (for downloaded updates), then falls back to bundled
 */
async function getBundledMetadata(): Promise<OpenSpecMetadata> {
	const bundledPromptsDir = getBundledPromptsPath();
	const userPromptsDir = getUserPromptsPath();

	// Check user prompts directory first (downloaded updates)
	try {
		const userMetadataPath = path.join(userPromptsDir, 'metadata.json');
		const content = await fs.readFile(userMetadataPath, 'utf-8');
		return JSON.parse(content);
	} catch {
		// User metadata not found, try bundled
	}

	// Fall back to bundled metadata
	try {
		const metadataPath = path.join(bundledPromptsDir, 'metadata.json');
		const content = await fs.readFile(metadataPath, 'utf-8');
		return JSON.parse(content);
	} catch {
		// Return default metadata if file doesn't exist
		return {
			lastRefreshed: '2026-01-12T00:00:00Z',
			commitSha: 'v0.19.0',
			sourceVersion: '0.19.0',
			sourceUrl: 'https://github.com/Fission-AI/OpenSpec',
		};
	}
}

/**
 * Get current OpenSpec metadata
 */
export async function getOpenSpecMetadata(): Promise<OpenSpecMetadata> {
	const customizations = await loadUserCustomizations();
	if (customizations?.metadata) {
		return customizations.metadata;
	}
	return getBundledMetadata();
}

/**
 * Get all OpenSpec prompts (bundled defaults merged with user customizations)
 */
export async function getOpenSpecPrompts(): Promise<OpenSpecCommand[]> {
	const bundled = await getBundledPrompts();
	const customizations = await loadUserCustomizations();

	const commands: OpenSpecCommand[] = [];

	for (const [id, data] of Object.entries(bundled)) {
		const customPrompt = customizations?.prompts?.[id];
		const isModified = customPrompt?.isModified ?? false;
		const prompt = isModified && customPrompt ? customPrompt.content : data.prompt;

		commands.push({
			id,
			command: `/openspec.${id}`,
			description: data.description,
			prompt,
			isCustom: data.isCustom,
			isModified,
		});
	}

	return commands;
}

/**
 * Save user's edit to an OpenSpec prompt
 */
export async function saveOpenSpecPrompt(id: string, content: string): Promise<void> {
	const customizations = (await loadUserCustomizations()) ?? {
		metadata: await getBundledMetadata(),
		prompts: {},
	};

	customizations.prompts[id] = {
		content,
		isModified: true,
		modifiedAt: new Date().toISOString(),
	};

	await saveUserCustomizations(customizations);
	logger.info(`Saved customization for openspec.${id}`, LOG_CONTEXT);
}

/**
 * Reset an OpenSpec prompt to its bundled default
 */
export async function resetOpenSpecPrompt(id: string): Promise<string> {
	const bundled = await getBundledPrompts();
	const defaultPrompt = bundled[id];

	if (!defaultPrompt) {
		throw new Error(`Unknown openspec command: ${id}`);
	}

	const customizations = await loadUserCustomizations();
	if (customizations?.prompts?.[id]) {
		delete customizations.prompts[id];
		await saveUserCustomizations(customizations);
		logger.info(`Reset openspec.${id} to bundled default`, LOG_CONTEXT);
	}

	return defaultPrompt.prompt;
}

/**
 * Mapping of our command IDs to the upstream OpenSpec workflow template files.
 *
 * As of OpenSpec v1.x, workflow prompts moved from a monolithic `openspec/AGENTS.md`
 * (parsed by Stage 1/2/3 headers) into per-workflow TypeScript modules under
 * `src/core/templates/workflows/*.ts`, each exposing an `instructions` template
 * literal. We fetch those files and extract that literal.
 *
 * Custom commands ('help', 'implement') are Maestro-only and are not fetched.
 */
const UPSTREAM_WORKFLOWS: Record<string, string> = {
	proposal: 'new-change.ts',
	apply: 'apply-change.ts',
	archive: 'archive-change.ts',
};

/**
 * Extract the body of an `instructions: \`...\`` template literal from a workflow
 * module. Handles backslash-escaped backticks (e.g. \`openspec list\`) by
 * unescaping any `\X` sequence to `X`, matching JS template literal semantics
 * for the escapes upstream actually emits.
 */
function extractInstructions(tsContent: string): string | null {
	const match = tsContent.match(/instructions:\s*`((?:\\[\s\S]|[^`\\])*)`/);
	if (!match) return null;
	return match[1].replace(/\\([\s\S])/g, '$1');
}

/**
 * Fetch latest prompts from the upstream OpenSpec repository and write them to
 * the user prompts directory so they shadow the bundled defaults.
 */
export async function refreshOpenSpecPrompts(): Promise<OpenSpecMetadata> {
	logger.info('Refreshing OpenSpec prompts from GitHub...', LOG_CONTEXT);

	// Resolve the version to fetch. Fall back to `main` if the API call fails.
	let version = 'main';
	try {
		const releaseResponse = await fetch(
			'https://api.github.com/repos/Fission-AI/OpenSpec/releases/latest',
			{
				headers: { 'User-Agent': 'Maestro-OpenSpec-Refresher' },
			}
		);
		if (releaseResponse.ok) {
			const releaseInfo = (await releaseResponse.json()) as { tag_name: string };
			version = releaseInfo.tag_name;
			logger.info(`Latest OpenSpec release: ${version}`, LOG_CONTEXT);
		}
	} catch {
		logger.warn('Could not fetch release info, using main branch', LOG_CONTEXT);
	}

	const userPromptsDir = getUserPromptsPath();
	await fs.mkdir(userPromptsDir, { recursive: true });

	let updatedCount = 0;
	const failures: string[] = [];

	for (const [cmdId, filename] of Object.entries(UPSTREAM_WORKFLOWS)) {
		const url = `https://raw.githubusercontent.com/Fission-AI/OpenSpec/${version}/src/core/templates/workflows/${filename}`;
		const response = await fetch(url);
		if (!response.ok) {
			failures.push(`${filename} (${response.status})`);
			logger.warn(`Failed to fetch ${filename}: ${response.statusText}`, LOG_CONTEXT);
			continue;
		}
		const tsContent = await response.text();
		const instructions = extractInstructions(tsContent);
		if (!instructions) {
			failures.push(`${filename} (no instructions block)`);
			logger.warn(`Could not extract instructions from ${filename}`, LOG_CONTEXT);
			continue;
		}
		const destPath = path.join(userPromptsDir, `openspec.${cmdId}.md`);
		await fs.writeFile(destPath, instructions, 'utf8');
		updatedCount += 1;
		logger.info(`Updated: openspec.${cmdId}.md`, LOG_CONTEXT);
	}

	if (updatedCount === 0) {
		throw new Error(
			`Failed to fetch any OpenSpec workflow prompts from ${version}: ${failures.join(', ')}`
		);
	}

	const newMetadata: OpenSpecMetadata = {
		lastRefreshed: new Date().toISOString(),
		commitSha: version,
		sourceVersion: version.replace(/^v/, ''),
		sourceUrl: 'https://github.com/Fission-AI/OpenSpec',
	};

	await fs.writeFile(
		path.join(userPromptsDir, 'metadata.json'),
		JSON.stringify(newMetadata, null, 2),
		'utf8'
	);

	const customizations = (await loadUserCustomizations()) ?? {
		metadata: newMetadata,
		prompts: {},
	};
	customizations.metadata = newMetadata;
	await saveUserCustomizations(customizations);

	logger.info(`Refreshed OpenSpec prompts to ${version}`, LOG_CONTEXT);

	return newMetadata;
}

/**
 * Get a single OpenSpec command by ID
 */
export async function getOpenSpecCommand(id: string): Promise<OpenSpecCommand | null> {
	const commands = await getOpenSpecPrompts();
	return commands.find((cmd) => cmd.id === id) ?? null;
}

/**
 * Get an OpenSpec command by its slash command string (e.g., "/openspec.proposal")
 */
export async function getOpenSpecCommandBySlash(
	slashCommand: string
): Promise<OpenSpecCommand | null> {
	const commands = await getOpenSpecPrompts();
	return commands.find((cmd) => cmd.command === slashCommand) ?? null;
}
