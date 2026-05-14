// `/usage` output parser for the maestro-p wrapper's --status mode.
//
// Phase 1 task 7 responsibilities: take the ANSI-prone TUI capture of Claude's
// `/usage` panel and produce a StatusSnapshot with three sections (current
// session, weekly all-models, weekly Sonnet-only). Each section yields a
// percent-used integer plus an absolute UTC ISO8601 reset timestamp computed
// from the trailing timezone in the reset spec.
//
// Why this lives separately from the wrapper entry point: the parser is the
// only piece of --status mode worth unit-testing against captured fixtures.
// Keeping it pure (raw → snapshot, no I/O) means task 8 can drop real
// captures from the conductor's two Max accounts into the fixtures folder
// and the existing test loop will exercise them with zero code changes.
//
// Two reset spec shapes the playbook documents:
//   - "6pm (America/Chicago)"               — today's wall clock in that zone;
//                                              if already past, roll forward
//                                              one calendar day in the zone
//                                              (calendar-day, not +24h, so DST
//                                              transitions stay correct).
//   - "May 16 at 6pm (America/Chicago)"     — specific month/day; year is the
//                                              first year (current or current+1)
//                                              for which the moment is in the
//                                              future relative to nowIso.
//
// Anything we can't classify (missing section, missing percent, unparseable
// reset spec, unrecognized month, unknown IANA zone) returns null. The caller
// in index.ts is responsible for surfacing a stderr error and exiting non-zero
// — the parser stays silent and lets failure bubble.

import { stripAnsiCodes } from '../shared/stringUtils';
import type { StatusSnapshot } from './json-emitter';

// Section markers — matched case-insensitively against ANSI-stripped lines via
// .includes(). Distinct enough that "Current session" can't false-match the
// weekly headers, but the section walker also gates by first-occurrence so a
// duplicate header later in the output wouldn't shadow the right block.
type SectionKey = 'session' | 'week_all_models' | 'week_sonnet_only';

const SECTION_DEFS: ReadonlyArray<{ key: SectionKey; needle: string }> = [
	{ key: 'session', needle: 'current session' },
	{ key: 'week_all_models', needle: 'current week (all models)' },
	{ key: 'week_sonnet_only', needle: 'current week (sonnet only)' },
];

// Percent on the same line as the bar. Playbook spells the pattern as
// "(\d+)% used" and the screenshot bears that out — looser variants (just
// "(\d+)%") risk picking up a percent inside the section header or a footer.
const PERCENT_PATTERN = /(\d+)%\s+used/i;

// Capture the reset spec — everything after "Resets " up to end-of-line. We
// hand the trimmed remainder to resolveResetTime, which owns the format split.
const RESETS_PATTERN = /Resets\s+(.+?)\s*$/i;

// Reset spec grammar: optional "Month Day at " prefix, then a 12-hour clock
// time (with optional minutes), then "(IANA/Zone)". The zone capture is
// permissive ([^)]+) because IANA names contain slashes, underscores, and
// occasional plus signs (Etc/GMT+5). Validation happens when Intl rejects it.
const RESET_SPEC_PATTERN =
	/^(?:(?<month>\w+)\s+(?<day>\d{1,2})\s+at\s+)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<ampm>am|pm)\s+\((?<tz>[^)]+)\)/i;

// 0-indexed for Date.UTC compatibility. Both abbreviated and full month names
// covered because the conductor flagged that real captures across accounts
// may differ in formatting and we want the parser to be tolerant up front.
const MONTHS: Readonly<Record<string, number>> = {
	jan: 0,
	january: 0,
	feb: 1,
	february: 1,
	mar: 2,
	march: 2,
	apr: 3,
	april: 3,
	may: 4,
	jun: 5,
	june: 5,
	jul: 6,
	july: 6,
	aug: 7,
	august: 7,
	sep: 8,
	sept: 8,
	september: 8,
	oct: 9,
	october: 9,
	nov: 10,
	november: 10,
	dec: 11,
	december: 11,
};

export function parseUsage(raw: string, nowIso: string, configDir = ''): StatusSnapshot | null {
	const now = new Date(nowIso);
	if (Number.isNaN(now.getTime())) {
		return null;
	}

	const lines = stripAnsiCodes(raw).split(/\r?\n/);

	// First-occurrence wins so a later header echo (e.g., in a footer summary)
	// can't shadow the real block.
	const sectionStarts: Partial<Record<SectionKey, number>> = {};
	for (let i = 0; i < lines.length; i++) {
		const lowered = lines[i].toLowerCase();
		for (const def of SECTION_DEFS) {
			if (sectionStarts[def.key] === undefined && lowered.includes(def.needle)) {
				sectionStarts[def.key] = i;
			}
		}
	}

	if (
		sectionStarts.session === undefined ||
		sectionStarts.week_all_models === undefined ||
		sectionStarts.week_sonnet_only === undefined
	) {
		return null;
	}

	// Order sections by their actual position in the output, then walk each
	// up to (but not including) the next section's start. Ordering by the
	// constant SECTION_DEFS list would be wrong if a future Claude release
	// reordered the panel — sorting by index keeps the scan robust.
	const orderedStarts = (Object.entries(sectionStarts) as Array<[SectionKey, number]>).sort(
		(a, b) => a[1] - b[1]
	);
	const sectionEnds = new Map<SectionKey, number>();
	for (let i = 0; i < orderedStarts.length; i++) {
		const [key] = orderedStarts[i];
		const end = i + 1 < orderedStarts.length ? orderedStarts[i + 1][1] : lines.length;
		sectionEnds.set(key, end);
	}

	const parsed: Partial<Record<SectionKey, { percent: number; resets_at: string }>> = {};

	for (const [key, start] of orderedStarts) {
		const end = sectionEnds.get(key) ?? lines.length;
		let percent: number | null = null;
		let resetsAt: string | null = null;

		for (let i = start; i < end; i++) {
			const line = lines[i];
			if (percent === null) {
				const pm = line.match(PERCENT_PATTERN);
				if (pm) {
					percent = Number.parseInt(pm[1], 10);
				}
			}
			if (resetsAt === null) {
				const rm = line.match(RESETS_PATTERN);
				if (rm) {
					resetsAt = resolveResetTime(rm[1].trim(), now);
					if (resetsAt === null) {
						// Spec line present but unparseable — bail loud rather
						// than emit a half-correct snapshot.
						return null;
					}
				}
			}
		}

		if (percent === null || resetsAt === null) {
			return null;
		}
		parsed[key] = { percent, resets_at: resetsAt };
	}

	return {
		type: 'status',
		config_dir: configDir,
		session: parsed.session!,
		week_all_models: parsed.week_all_models!,
		week_sonnet_only: parsed.week_sonnet_only!,
	};
}

function resolveResetTime(spec: string, now: Date): string | null {
	const m = spec.match(RESET_SPEC_PATTERN);
	if (!m || !m.groups) {
		return null;
	}
	const { month, day, hour, minute, ampm, tz } = m.groups;

	let hour24 = Number.parseInt(hour, 10);
	if (hour24 < 1 || hour24 > 12) {
		return null;
	}
	const isPm = ampm.toLowerCase() === 'pm';
	if (isPm && hour24 !== 12) {
		hour24 += 12;
	}
	if (!isPm && hour24 === 12) {
		hour24 = 0;
	}
	const min = minute ? Number.parseInt(minute, 10) : 0;

	try {
		if (month && day) {
			const monthIdx = MONTHS[month.toLowerCase()];
			if (monthIdx === undefined) {
				return null;
			}
			const dayNum = Number.parseInt(day, 10);
			// Try current year in the zone; if that lands before `now`, roll
			// to next year. This handles the December→January wrap when the
			// user runs --status on the last day of the year.
			const yearGuess = getYearInZone(now, tz);
			let result = zonedTimeToUtc(yearGuess, monthIdx, dayNum, hour24, min, tz);
			if (result === null) {
				return null;
			}
			if (result.getTime() < now.getTime()) {
				result = zonedTimeToUtc(yearGuess + 1, monthIdx, dayNum, hour24, min, tz);
				if (result === null) {
					return null;
				}
			}
			return result.toISOString();
		}

		const today = getDateInZone(now, tz);
		if (today === null) {
			return null;
		}
		let result = zonedTimeToUtc(today.year, today.month, today.day, hour24, min, tz);
		if (result === null) {
			return null;
		}
		if (result.getTime() < now.getTime()) {
			// Roll forward one calendar day in the zone — bumping the day
			// field and re-converting preserves correctness across DST
			// transitions (a flat +24h would drift by an hour twice a year).
			result = zonedTimeToUtc(today.year, today.month, today.day + 1, hour24, min, tz);
			if (result === null) {
				return null;
			}
		}
		return result.toISOString();
	} catch {
		return null;
	}
}

// Convert wall-clock components in a specific IANA zone to the UTC Date that
// represents that instant. Standard "format-then-diff" trick: build a guess
// pretending the wall clock is UTC, format that guess back into the target
// zone, compute the offset between what we wanted and what we got, then add
// the offset to the guess. One round of formatting is enough because the
// offset doesn't depend on the inputs themselves — only on the zone and the
// approximate moment, both of which our guess already captures.
function zonedTimeToUtc(
	year: number,
	monthIdx: number,
	day: number,
	hour: number,
	minute: number,
	tz: string
): Date | null {
	const utcGuess = new Date(Date.UTC(year, monthIdx, day, hour, minute));
	if (Number.isNaN(utcGuess.getTime())) {
		return null;
	}

	const parts = formatPartsInZone(utcGuess, tz);
	if (parts === null) {
		return null;
	}

	const wanted = Date.UTC(year, monthIdx, day, hour, minute);
	const got = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute);
	return new Date(utcGuess.getTime() + (wanted - got));
}

function getYearInZone(when: Date, tz: string): number {
	const parts = formatPartsInZone(when, tz);
	if (parts === null) {
		// Caller has already validated the zone via an earlier conversion,
		// but if Intl rejects, fall back to UTC year — better than crashing.
		return when.getUTCFullYear();
	}
	return parts.year;
}

function getDateInZone(
	when: Date,
	tz: string
): { year: number; month: number; day: number } | null {
	const parts = formatPartsInZone(when, tz);
	if (parts === null) {
		return null;
	}
	return { year: parts.year, month: parts.month, day: parts.day };
}

interface ZoneParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

function formatPartsInZone(when: Date, tz: string): ZoneParts | null {
	try {
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		const parts = fmt.formatToParts(when);
		const get = (type: string): number | null => {
			const p = parts.find((x) => x.type === type);
			return p ? Number.parseInt(p.value, 10) : null;
		};
		const year = get('year');
		const monthOneBased = get('month');
		const day = get('day');
		let hour = get('hour');
		const minute = get('minute');
		if (
			year === null ||
			monthOneBased === null ||
			day === null ||
			hour === null ||
			minute === null
		) {
			return null;
		}
		// Some ICU builds report midnight as "24" rather than "00" under
		// hour12: false. Normalize so wanted/got diff math stays sane.
		if (hour === 24) {
			hour = 0;
		}
		return { year, month: monthOneBased - 1, day, hour, minute };
	} catch {
		return null;
	}
}
