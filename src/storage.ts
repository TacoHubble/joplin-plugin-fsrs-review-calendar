import joplin from 'api';
import { ModelType } from 'api/types';
import { Card, State } from 'ts-fsrs';
import { initializeCard } from './fsrsEngine';

export const FSRS_STATE_KEY = 'fsrs_state';
export const FSRS_CALENDAR_OPTIONS_KEY = 'fsrs_calendar_options';
export const CALENDAR_NOTEBOOK_TITLE = 'Calendar';
const METADATA_PATTERN = /(?:\r?\n)?<!--\s*fsrs-state:\s*(\{[\s\S]*\})\s*-->\s*$/;

interface NoteRecord {
	id: string;
	title: string;
	body?: string;
	parent_id?: string;
	is_todo?: number;
	todo_due?: number;
	todo_completed?: number;
	created_time?: number;
}

interface Page<T> {
	items: T[];
	has_more: boolean;
}

export interface TrackedNote {
	id: string;
	title: string;
	card: Card;
	memo: string;
	options: CalendarOptions;
	createdTime: Date;
}

export interface AgendaTodo {
	id: string;
	title: string;
	memo: string;
	due?: Date;
	createdTime: Date;
}

export interface CalendarOptions {
	recurring: boolean;
	allDay: boolean;
	end?: string;
	timeZone: string;
	secondaryTimeZone?: string;
	rrule?: string;
	reminders: ReminderSpec[];
	calendarName: string;
	color?: string;
	visibility: 'public' | 'freebusy' | 'readonly' | 'edit';
	attendees: Attendee[];
	location?: string;
	meetingUrl?: string;
	isTask: boolean;
	completed: boolean;
	history: ReviewHistoryEntry[];
	excludedDates: string[];
	plannedMinutes: number;
}

export interface ReviewHistoryEntry {
	at: string;
	action: 'again' | 'good' | 'snooze' | 'skip' | 'undo';
	previousDue: string;
	resultingDue: string;
	previousCard?: StoredCard;
	minutes?: number;
}

export interface ReminderSpec {
	channel: 'desktop' | 'push' | 'email';
	offsetMinutes: number;
}

export interface Attendee {
	name?: string;
	email: string;
	status: 'needs-action' | 'accepted' | 'declined' | 'tentative';
}

export interface CreateCalendarMemoInput {
	title: string;
	memo: string;
	due: Date;
	allDay: boolean;
	recurring: boolean;
	tagName: string;
	end?: Date;
	timeZone?: string;
	secondaryTimeZone?: string;
	rrule?: string;
	reminders?: ReminderSpec[];
	calendarName?: string;
	color?: string;
	visibility?: CalendarOptions['visibility'];
	attendees?: Attendee[];
	location?: string;
	meetingUrl?: string;
	isTask?: boolean;
	plannedMinutes?: number;
}

/**
 * JSON-safe shape written to Joplin user data. Dates are explicit ISO strings
 * so storage remains stable across Joplin versions and sync targets.
 */
export type StoredCard = Omit<Card, 'due' | 'last_review'> & {
	due: string;
	last_review?: string | null;
};

export async function fetchTrackedNotes(tagName: string): Promise<TrackedNote[]> {
	const normalizedTag = tagName.trim().toLocaleLowerCase();
	if (!normalizedTag) return [];

	const tags = await getAllPages<{ id: string; title: string }>(['tags'], {
		fields: ['id', 'title'],
	});
	const matchingTags = tags.filter(tag => tag.title.trim().toLocaleLowerCase() === normalizedTag);
	if (!matchingTags.length) return [];

	const notesById = new Map<string, NoteRecord>();
	for (const tag of matchingTags) {
		const notes = await getAllPages<NoteRecord>(['tags', tag.id, 'notes'], {
			fields: ['id', 'title', 'body', 'parent_id', 'is_todo', 'todo_due', 'todo_completed', 'created_time'],
		});
		for (const note of notes) notesById.set(note.id, note);
	}

	const tracked: TrackedNote[] = [];
	for (const note of notesById.values()) {
		// Completed native Joplin to-dos stay safely in the Calendar notebook,
		// but disappear from the active calendar. Unchecking them makes them
		// eligible again on the next workspace refresh.
		if (Number(note.todo_completed ?? 0) > 0) continue;
		let card = await readCard(note);
		if (!card) {
			card = initializeCard();
			await writeCard(note.id, card, note.body);
		}
		tracked.push({
			id: note.id,
			title: note.title || 'Untitled note',
			card,
			memo: memoFromBody(note.body ?? ''),
			options: await readCalendarOptions(note.id),
			createdTime: new Date(Number(note.created_time ?? note.todo_due ?? Date.now())),
		});
	}

	return tracked;
}

export async function getTrackedNote(noteId: string): Promise<TrackedNote> {
	const note = await joplin.data.get(['notes', noteId], {
		fields: ['id', 'title', 'body', 'parent_id', 'is_todo', 'todo_due', 'todo_completed', 'created_time'],
	}) as NoteRecord;
	let card = await readCard(note);
	if (!card) {
		card = initializeCard();
		await writeCard(note.id, card, note.body);
	}
	return {
		id: note.id,
		title: note.title || 'Untitled note',
		card,
		memo: memoFromBody(note.body ?? ''),
		options: await readCalendarOptions(note.id),
		createdTime: new Date(Number(note.created_time ?? note.todo_due ?? Date.now())),
	};
}

/** Returns every incomplete native Joplin to-do, including untagged notes. */
export async function fetchIncompleteTodos(): Promise<AgendaTodo[]> {
	const notes = await getAllPages<NoteRecord & { created_time?: number }>(['notes'], {
		fields: ['id', 'title', 'body', 'is_todo', 'todo_due', 'todo_completed', 'created_time'],
		order_by: 'todo_due',
		order_dir: 'ASC',
	});
	return notes
		.filter(note => Number(note.is_todo ?? 0) === 1 && Number(note.todo_completed ?? 0) === 0)
		.map(note => ({
			id: note.id,
			title: note.title || 'Untitled to-do',
			memo: memoFromBody(note.body ?? ''),
			due: Number(note.todo_due ?? 0) > 0 ? new Date(Number(note.todo_due)) : undefined,
			createdTime: new Date(Number(note.created_time ?? Date.now())),
		}));
}

export async function createCalendarMemo(input: CreateCalendarMemoInput): Promise<TrackedNote> {
	const title = input.title.trim();
	if (!title) throw new Error('A title is required.');
	if (Number.isNaN(input.due.getTime())) throw new Error('The memo date is invalid.');

	const folder = await ensureCalendarNotebook();
	const note = await joplin.data.post(['notes'], null, {
		title,
		body: input.memo.trim(),
		parent_id: folder.id,
		is_todo: 1,
		todo_due: input.due.getTime(),
		todo_completed: 0,
	}) as NoteRecord;

	const tag = await findOrCreateTag(input.tagName);
	await joplin.data.post(['tags', tag.id, 'notes'], null, { id: note.id });

	const card = initializeCard(input.due);
	card.due = new Date(input.due);
	const options: CalendarOptions = normalizeCalendarOptions({
		recurring: input.recurring,
		allDay: input.allDay,
		end: input.end?.toISOString(),
		timeZone: input.timeZone,
		secondaryTimeZone: input.secondaryTimeZone,
		rrule: input.rrule,
		reminders: input.reminders,
		calendarName: input.calendarName,
		color: input.color,
		visibility: input.visibility,
		attendees: input.attendees,
		location: input.location,
		meetingUrl: input.meetingUrl,
		isTask: true,
		plannedMinutes: input.plannedMinutes,
	});
	await writeCard(note.id, card, input.memo);
	await writeCalendarOptions(note.id, options);

	return { id: note.id, title, card, memo: input.memo.trim(), options, createdTime: new Date(Number(note.created_time ?? Date.now())) };
}

export async function writeCalendarOptions(noteId: string, options: CalendarOptions): Promise<void> {
	await joplin.data.userDataSet(
		ModelType.Note,
		noteId,
		FSRS_CALENDAR_OPTIONS_KEY,
		normalizeCalendarOptions(options),
	);
}

export async function writeCard(noteId: string, card: Card, knownBody?: string): Promise<void> {
	const stored = serializeCard(card);
	try {
		await joplin.data.userDataSet(ModelType.Note, noteId, FSRS_STATE_KEY, stored);
	} catch (error) {
		// Older Joplin builds may not expose userData. Keep the documented body
		// comment fallback isolated at the very bottom of the note.
		const body = knownBody ?? String((await joplin.data.get(['notes', noteId], {
			fields: ['body'],
		})).body ?? '');
		const withoutOldMetadata = body.replace(METADATA_PATTERN, '').trimEnd();
		const separator = withoutOldMetadata ? '\n\n' : '';
		await joplin.data.put(['notes', noteId], null, {
			body: `${withoutOldMetadata}${separator}<!-- fsrs-state: ${JSON.stringify(stored)} -->`,
		});
		console.warn('FSRS Review Calendar: user data unavailable; used note-body fallback.', error);
	}
	// Mirror the adaptive review time into Joplin's native to-do due field so
	// calendar entries remain useful in Joplin's standard note list as well.
	await joplin.data.put(['notes', noteId], null, { todo_due: card.due.getTime() });
}

export async function ensureCalendarNotebook(): Promise<{ id: string; title: string }> {
	const folders = await getAllPages<{ id: string; title: string }>(['folders'], {
		fields: ['id', 'title'],
	});
	const existing = folders.find(folder => folder.title.trim().toLocaleLowerCase() === CALENDAR_NOTEBOOK_TITLE.toLocaleLowerCase());
	if (existing) return existing;
	return await joplin.data.post(['folders'], null, { title: CALENDAR_NOTEBOOK_TITLE }) as { id: string; title: string };
}

export async function completeCalendarItem(noteId: string): Promise<void> {
	// is_todo also upgrades calendar memos created by pre-1.3 releases.
	await joplin.data.put(['notes', noteId], null, { is_todo: 1, todo_completed: Date.now() });
}

export async function updateCalendarMemo(
	noteId: string,
	input: { title: string; memo: string; due: Date; end?: Date; options: CalendarOptions },
): Promise<TrackedNote> {
	const title = input.title.trim();
	if (!title) throw new Error('A title is required.');
	const current = await getTrackedNote(noteId);
	await joplin.data.put(['notes', noteId], null, {
		title,
		body: input.memo.trim(),
		is_todo: 1,
		todo_due: input.due.getTime(),
	});
	const card = rescheduleCard(current.card, input.due.toISOString());
	const options = normalizeCalendarOptions({ ...input.options, end: input.end?.toISOString() });
	await writeCard(noteId, card, input.memo);
	await writeCalendarOptions(noteId, options);
	return { id: noteId, title, memo: input.memo.trim(), card, options, createdTime: current.createdTime };
}

export function appendHistory(options: CalendarOptions, entry: ReviewHistoryEntry): CalendarOptions {
	return normalizeCalendarOptions({ ...options, history: [...options.history, entry].slice(-250) });
}

export function storedCard(card: Card): StoredCard { return serializeCard(card); }

export function restoreStoredCard(value: StoredCard): Card {
	const card = deserializeCard(value);
	if (!card) throw new Error('The saved review state cannot be restored.');
	return card;
}

export function rescheduleCard(card: Card, calendarDate: string): Card {
	let due: Date;
	if (/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) {
		const [year, month, day] = calendarDate.split('-').map(Number);
		due = new Date(year, month - 1, day, 12, 0, 0, 0);
		if (due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) {
			throw new Error('The new review date does not exist.');
		}
	} else {
		due = new Date(calendarDate);
	}
	if (Number.isNaN(due.getTime())) throw new Error('The new review date is invalid.');
	return { ...card, due };
}

async function readCalendarOptions(noteId: string): Promise<CalendarOptions> {
	try {
		const value = await joplin.data.userDataGet<Partial<CalendarOptions>>(
			ModelType.Note,
			noteId,
			FSRS_CALENDAR_OPTIONS_KEY,
		);
		return normalizeCalendarOptions(value);
	} catch {
		// Existing FSRS-tagged notes retain the original recurring/all-day behavior.
		return normalizeCalendarOptions({ recurring: true, allDay: true });
	}
}

function normalizeCalendarOptions(value?: Partial<CalendarOptions>): CalendarOptions {
	const validChannels = new Set(['desktop', 'push', 'email']);
	const reminders = Array.isArray(value?.reminders)
		? value.reminders
			.filter(item => item && validChannels.has(item.channel) && Number.isFinite(item.offsetMinutes))
			.map(item => ({ channel: item.channel, offsetMinutes: Math.max(0, Math.round(item.offsetMinutes)) }))
		: [];
	const attendees = Array.isArray(value?.attendees)
		? value.attendees.filter(item => item && typeof item.email === 'string' && item.email.includes('@'))
		: [];
	const visibility = ['public', 'freebusy', 'readonly', 'edit'].includes(String(value?.visibility))
		? value!.visibility as CalendarOptions['visibility']
		: 'edit';
	return {
		recurring: value?.recurring !== false,
		allDay: value?.allDay !== false,
		end: cleanString(value?.end),
		timeZone: cleanString(value?.timeZone) ?? 'floating',
		secondaryTimeZone: cleanString(value?.secondaryTimeZone),
		rrule: cleanString(value?.rrule),
		reminders,
		calendarName: cleanString(value?.calendarName) ?? 'Reviews',
		color: /^#[0-9a-f]{6}$/i.test(String(value?.color ?? '')) ? value!.color : undefined,
		visibility,
		attendees,
		location: cleanString(value?.location),
		meetingUrl: cleanString(value?.meetingUrl),
		isTask: Boolean(value?.isTask),
		completed: Boolean(value?.completed),
		history: Array.isArray(value?.history) ? value.history.filter(validHistoryEntry).slice(-250) : [],
		excludedDates: Array.isArray(value?.excludedDates) ? value.excludedDates.filter(item => typeof item === 'string').slice(-500) : [],
		plannedMinutes: Math.min(24 * 60, Math.max(5, Math.round(finiteNumber(value?.plannedMinutes, 60)))),
	};
}

function validHistoryEntry(value: unknown): value is ReviewHistoryEntry {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return typeof item.at === 'string'
		&& ['again', 'good', 'snooze', 'skip', 'undo'].includes(String(item.action))
		&& typeof item.previousDue === 'string'
		&& typeof item.resultingDue === 'string';
}

function cleanString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function findOrCreateTag(tagName: string): Promise<{ id: string; title: string }> {
	const title = tagName.trim();
	if (!title) throw new Error('The configured review tag is empty.');
	const tags = await getAllPages<{ id: string; title: string }>(['tags'], {
		fields: ['id', 'title'],
	});
	const existing = tags.find(tag => tag.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase());
	if (existing) return existing;
	return await joplin.data.post(['tags'], null, { title }) as { id: string; title: string };
}

function memoFromBody(body: string): string {
	return body
		.replace(METADATA_PATTERN, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 240);
}

function serializeCard(card: Card): StoredCard {
	return {
		...card,
		due: card.due.toISOString(),
		last_review: card.last_review ? card.last_review.toISOString() : null,
	};
}

function deserializeCard(value: unknown): Card | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as Record<string, unknown>;
	const due = new Date(String(source.due ?? ''));
	if (Number.isNaN(due.getTime())) return null;

	const empty = initializeCard(due);
	const lastReviewValue = source.last_review;
	const lastReview = lastReviewValue ? new Date(String(lastReviewValue)) : undefined;

	return {
		...empty,
		...source,
		due,
		last_review: lastReview && !Number.isNaN(lastReview.getTime()) ? lastReview : undefined,
		stability: finiteNumber(source.stability, empty.stability),
		difficulty: finiteNumber(source.difficulty, empty.difficulty),
		elapsed_days: finiteNumber(source.elapsed_days, empty.elapsed_days),
		scheduled_days: finiteNumber(source.scheduled_days, empty.scheduled_days),
		reps: finiteNumber(source.reps, empty.reps),
		lapses: finiteNumber(source.lapses, empty.lapses),
		state: validState(source.state) ? source.state : empty.state,
	} as Card;
}

async function readCard(note: NoteRecord): Promise<Card | null> {
	try {
		const stored = await joplin.data.userDataGet<unknown>(ModelType.Note, note.id, FSRS_STATE_KEY);
		const card = deserializeCard(stored);
		if (card) return card;
	} catch {
		// Missing user data and unsupported userData APIs both continue to the
		// portable body-comment fallback below.
	}

	const match = (note.body ?? '').match(METADATA_PATTERN);
	if (!match) return null;
	try {
		const card = deserializeCard(JSON.parse(match[1]));
		if (card) {
			// Opportunistically migrate fallback metadata to synchronized user data.
			try {
				await joplin.data.userDataSet(ModelType.Note, note.id, FSRS_STATE_KEY, serializeCard(card));
			} catch {
				// The fallback remains authoritative when user data is unavailable.
			}
		}
		return card;
	} catch (error) {
		console.warn(`FSRS Review Calendar: invalid fallback metadata on note ${note.id}.`, error);
		return null;
	}
}

async function getAllPages<T>(path: string[], query: Record<string, unknown>): Promise<T[]> {
	const items: T[] = [];
	let page = 1;
	let hasMore = true;
	while (hasMore) {
		const response = await joplin.data.get(path, { ...query, page, limit: 100 }) as Page<T>;
		items.push(...(response.items ?? []));
		hasMore = Boolean(response.has_more);
		page += 1;
	}
	return items;
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validState(value: unknown): value is State {
	return value === State.New || value === State.Learning || value === State.Review || value === State.Relearning;
}
