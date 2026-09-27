import joplin from 'api';
import {
	MenuItemLocation,
	SettingItemType,
	ToastType,
	ToolbarButtonLocation,
	ViewHandle,
} from 'api/types';
import { rrulestr } from 'rrule';
import webviewHtml from './webview/index.html';
import {
	IntervalPreset,
	isReviewRating,
	previewIntervals,
	scheduleReview,
} from './fsrsEngine';
import {
	createCalendarMemo,
	appendHistory,
	CalendarOptions,
	completeCalendarItem,
	ensureCalendarNotebook,
	fetchIncompleteTodos,
	fetchTrackedNotes,
	getTrackedNote,
	rescheduleCard,
	restoreStoredCard,
	storedCard,
	TrackedNote,
	updateCalendarMemo,
	writeCalendarOptions,
	writeCard,
} from './storage';

const TOGGLE_COMMAND = 'fsrsReviewCalendar.toggle';
const SETTING_SECTION = 'fsrsReviewCalendar.settings';
const TAG_SETTING = 'trackingTag';
const INTERVAL_PRESET_SETTING = 'intervalPreset';
const DAILY_CAPACITY_SETTING = 'dailyCapacityMinutes';
const REDUCED_DATA_SETTING = 'reducedDataMode';
const EDITOR_VIEW_ID = 'fsrsReviewCalendar.editor';
const PANEL_VIEW_ID = 'fsrsReviewCalendar.mobilePanel';

type IncomingMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'openReview'; noteId: string }
	| { type: 'openTodo'; noteId: string }
	| { type: 'rate'; noteId: string; rating: unknown; studiedMinutes?: number }
	| { type: 'snooze'; noteId: string; days: number; action?: 'snooze' | 'skip' }
	| { type: 'undoReview'; noteId: string }
	| { type: 'reschedule'; noteId: string; date: string; allDay: boolean }
	| { type: 'updateTiming'; noteId: string; start: string; end?: string; allDay: boolean }
	| { type: 'setRecurring'; noteId: string; recurring: boolean }
	| { type: 'complete'; noteId: string }
	| { type: 'repairData' }
	| { type: 'exportBackup' }
	| { type: 'importBackup'; text: string }
	| { type: 'createSample' }
	| { type: 'updateMemo'; noteId: string; title: string; memo: string; due: string; end?: string; allDay: boolean; recurring: boolean; timeZone?: string; secondaryTimeZone?: string; rrule?: string; reminders?: CalendarOptions['reminders']; calendarName?: string; color?: string; visibility?: CalendarOptions['visibility']; attendees?: CalendarOptions['attendees']; location?: string; meetingUrl?: string; plannedMinutes?: number; editScope?: 'series' | 'occurrence'; occurrenceStart?: string }
	| { type: 'exportIcs' }
	| { type: 'importIcs'; text: string }
	| { type: 'createMemo'; title: string; memo: string; due: string; end?: string; allDay: boolean; recurring: boolean; timeZone?: string; secondaryTimeZone?: string; rrule?: string; reminders?: CalendarOptions['reminders']; calendarName?: string; color?: string; visibility?: CalendarOptions['visibility']; attendees?: CalendarOptions['attendees']; location?: string; meetingUrl?: string; isTask?: boolean; plannedMinutes?: number };

interface CalendarEvent {
	id: string;
	title: string;
	start: string;
	end?: string;
	rrule?: string;
	exdate?: string[];
	duration?: string;
	allDay: boolean;
	backgroundColor: string;
	borderColor: string;
	editable?: boolean;
	startEditable?: boolean;
	durationEditable?: boolean;
	extendedProps: {
		noteId: string;
		memo: string;
		recurring: boolean;
		allDay: boolean;
		status: 'overdue' | 'today' | 'upcoming';
		stability?: number;
		reps?: number;
		intervals?: ReturnType<typeof previewIntervals>;
		options: CalendarOptions;
		trackedReview: boolean;
		agendaOnly?: boolean;
		undated?: boolean;
		originalDue?: string;
		historyMarker?: 'created';
	};
}

const readyEditorHandles = new Set<ViewHandle>();
const readyPanelHandles = new Set<ViewHandle>();
let mobilePanelHandle: ViewHandle | undefined;
let isMobile = false;
let intervalPreset: IntervalPreset = 'standard';
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let activeRefresh: Promise<void> | null = null;
let refreshAgain = false;
const deliveredReminders = new Set<string>();

joplin.plugins.register({
	onStart: async () => {
		isMobile = (await joplin.versionInfo()).platform === 'mobile';
		await registerSettings();
		intervalPreset = normalizeIntervalPreset(await joplin.settings.value(INTERVAL_PRESET_SETTING));
		// A temporarily locked or still-syncing profile must never prevent Joplin
		// from starting. Calendar creation is retried lazily when an item is added.
		try {
			await ensureCalendarNotebook();
		} catch (error) {
			console.warn('FSRS Review Calendar: Calendar notebook initialization will be retried later.', error);
		}
		if (isMobile) await registerCalendarPanel();
		else await registerCalendarEditor();
		await registerCommands();

		await joplin.workspace.onNoteChange(() => scheduleRefresh());
		await joplin.workspace.onSyncComplete(() => scheduleRefresh());
		await joplin.settings.onChange(async event => {
			if (event.keys.includes(INTERVAL_PRESET_SETTING)) intervalPreset = normalizeIntervalPreset(await joplin.settings.value(INTERVAL_PRESET_SETTING));
			if (event.keys.some(key => [TAG_SETTING, INTERVAL_PRESET_SETTING, DAILY_CAPACITY_SETTING, REDUCED_DATA_SETTING].includes(key))) scheduleRefresh(0);
		});
		if (!isMobile) {
			setInterval(() => void checkDesktopReminders(), 60_000);
			setTimeout(() => void checkDesktopReminders(), 2_000);
		}
	},
});

async function registerSettings(): Promise<void> {
	await joplin.settings.registerSection(SETTING_SECTION, {
		label: 'FSRS Review Calendar',
		iconName: 'fas fa-calendar-alt',
	});
	await joplin.settings.registerSettings({
		[TAG_SETTING]: {
			value: 'fsrs',
			type: SettingItemType.String,
			section: SETTING_SECTION,
			public: true,
			label: 'Review tag',
			description: 'Only notes with this tag appear in the FSRS review calendar.',
		},
		[INTERVAL_PRESET_SETTING]: {
			value: 'standard', type: SettingItemType.String, section: SETTING_SECTION, public: true,
			label: 'Review spacing', description: 'Controls FSRS retention and topic-scale minimum intervals.',
			isEnum: true, options: { relaxed: 'Relaxed (7d → 21d)', standard: 'Standard (3d → 7d)', intensive: 'Intensive (2d → 4d)', exam: 'Exam preparation (1d → 3d)' },
		},
		[DAILY_CAPACITY_SETTING]: {
			value: 240, type: SettingItemType.Int, section: SETTING_SECTION, public: true,
			label: 'Daily study capacity (minutes)', description: 'Today view warns when planned work exceeds this amount.',
		},
		[REDUCED_DATA_SETTING]: {
			value: false, type: SettingItemType.Bool, section: SETTING_SECTION, public: true,
			label: 'Reduced-data mode', description: 'Limits the calendar to 500 active items for faster mobile use.',
		},
	});
}

async function registerCalendarEditor(): Promise<void> {
	await joplin.views.editors.register(EDITOR_VIEW_ID, {
		// The calendar is available for every selected note. It is only shown
		// when the user invokes our toggle command, so normal editing remains the
		// default while Joplin can switch the entire editor area to the calendar.
		onActivationCheck: async () => true,
		onSetup: async (handle: ViewHandle) => {
			await joplin.views.editors.setHtml(handle, webviewHtml);
			await joplin.views.editors.addScript(handle, './webview/style.css');
			await joplin.views.editors.addScript(handle, './webview/index.js');
			await joplin.views.editors.onMessage(handle, async (message: unknown) => {
				if ((message as IncomingMessage)?.type === 'ready') readyEditorHandles.add(handle);
				return await handleMessage(message as IncomingMessage);
			});
			await joplin.views.editors.onUpdate(handle, async () => {
				if (await joplin.views.editors.isVisible(handle)) scheduleRefresh(0);
			});
		},
	});
}

async function registerCalendarPanel(): Promise<void> {
	mobilePanelHandle = await joplin.views.panels.create(PANEL_VIEW_ID);
	await joplin.views.panels.setHtml(mobilePanelHandle, webviewHtml);
	await joplin.views.panels.addScript(mobilePanelHandle, './webview/style.css');
	await joplin.views.panels.addScript(mobilePanelHandle, './webview/index.js');
	await joplin.views.panels.onMessage(mobilePanelHandle, async (message: unknown) => {
		if ((message as IncomingMessage)?.type === 'ready' && mobilePanelHandle) readyPanelHandles.add(mobilePanelHandle);
		return await handleMessage(message as IncomingMessage);
	});
}

async function registerCommands(): Promise<void> {
	await joplin.commands.register({
		name: TOGGLE_COMMAND,
		label: 'Toggle FSRS Review Calendar',
		iconName: 'fas fa-calendar-alt',
		execute: async () => {
			if (isMobile && mobilePanelHandle) await joplin.views.panels.show(mobilePanelHandle, true);
			else await joplin.commands.execute('toggleEditorPlugin');
			await refreshCalendar();
		},
	});

	if (!isMobile) {
		await joplin.views.menuItems.create(
			'fsrsReviewCalendar.toolsMenu',
			TOGGLE_COMMAND,
			MenuItemLocation.Tools,
		);
	}
	await joplin.views.toolbarButtons.create(
		'fsrsReviewCalendar.toolbarButton',
		TOGGLE_COMMAND,
		ToolbarButtonLocation.NoteToolbar,
	);
}

async function handleMessage(message: IncomingMessage): Promise<unknown> {
	try {
		switch (message?.type) {
			case 'ready':
			case 'refresh':
				// Return initial data through the request-response bridge. Joplin can
				// drop a plugin-to-webview post while the editor is being activated.
				return { ok: true, calendar: await buildCalendarData() };

			case 'openReview': {
				assertNoteId(message.noteId);
				await joplin.commands.execute('openNote', message.noteId);
				return { ok: true, review: await reviewPayload(message.noteId) };
			}

			case 'openTodo': {
				assertNoteId(message.noteId);
				await joplin.commands.execute('openNote', message.noteId);
				return { ok: true };
			}

			case 'rate': {
				assertNoteId(message.noteId);
				if (!isReviewRating(message.rating)) throw new Error('Unknown review rating.');
				const note = await getTrackedNote(message.noteId);
				if (!note.options.recurring) {
					throw new Error('Turn on “Repeat with FSRS” before submitting a review rating.');
				}
				const updated = scheduleReview(note.card, message.rating, new Date(), intervalPreset);
				const shifted = shiftEndWithStart(note.options, note.card.due, updated.due);
				const options = appendHistory(shifted, {
					at: new Date().toISOString(), action: message.rating === 1 ? 'again' : 'good',
					previousDue: note.card.due.toISOString(), resultingDue: updated.due.toISOString(), previousCard: storedCard(note.card),
					minutes: Math.max(0, Math.min(24 * 60, Math.round(Number(message.studiedMinutes) || 0))),
				});
				await writeCard(note.id, updated);
				await writeCalendarOptions(note.id, options);
				return {
					ok: true,
					review: toReviewPayload({ ...note, card: updated, options }),
					calendar: await buildCalendarData(),
				};
			}

			case 'snooze': {
				assertNoteId(message.noteId);
				const days = Math.min(365, Math.max(1, Math.round(Number(message.days) || 1)));
				const note = await getTrackedNote(message.noteId);
				const due = new Date();
				due.setDate(due.getDate() + days);
				due.setHours(note.options.allDay ? 12 : note.card.due.getHours(), note.options.allDay ? 0 : note.card.due.getMinutes(), 0, 0);
				const updated = rescheduleCard(note.card, due.toISOString());
				const options = appendHistory(shiftEndWithStart(note.options, note.card.due, updated.due), {
					at: new Date().toISOString(), action: message.action === 'skip' ? 'skip' : 'snooze',
					previousDue: note.card.due.toISOString(), resultingDue: updated.due.toISOString(), previousCard: storedCard(note.card),
				});
				await writeCard(note.id, updated);
				await writeCalendarOptions(note.id, options);
				return { ok: true, review: toReviewPayload({ ...note, card: updated, options }), calendar: await buildCalendarData() };
			}

			case 'undoReview': {
				assertNoteId(message.noteId);
				const note = await getTrackedNote(message.noteId);
				const last = [...note.options.history].reverse().find(item => item.previousCard);
				if (!last?.previousCard) throw new Error('There is no recent scheduling action to undo.');
				const card = restoreStoredCard(last.previousCard);
				const history = note.options.history.slice(0, note.options.history.lastIndexOf(last));
				const options = { ...note.options, history };
				await writeCard(note.id, card);
				await writeCalendarOptions(note.id, options);
				return { ok: true, review: toReviewPayload({ ...note, card, options }), calendar: await buildCalendarData() };
			}

			case 'reschedule': {
				assertNoteId(message.noteId);
				const note = await getTrackedNote(message.noteId);
				await writeCard(note.id, rescheduleCard(note.card, message.date));
				await writeCalendarOptions(note.id, { ...note.options, allDay: Boolean(message.allDay) });
				return { ok: true, calendar: await buildCalendarData() };
			}

			case 'updateTiming': {
				assertNoteId(message.noteId);
				const note = await getTrackedNote(message.noteId);
				const start = parseCalendarDue(message.start);
				const end = message.end ? parseCalendarDue(message.end) : undefined;
				if (end && end <= start) throw new Error('The event must end after it starts.');
				await writeCard(note.id, rescheduleCard(note.card, message.start));
				await writeCalendarOptions(note.id, {
					...note.options,
					allDay: Boolean(message.allDay),
					end: end?.toISOString(),
				});
				return { ok: true, calendar: await buildCalendarData() };
			}

			case 'setRecurring': {
				assertNoteId(message.noteId);
				const note = await getTrackedNote(message.noteId);
				const options = { ...note.options, recurring: Boolean(message.recurring) };
				await writeCalendarOptions(note.id, options);
				return { ok: true, review: toReviewPayload({ ...note, options }), calendar: await buildCalendarData() };
			}

			case 'complete': {
				assertNoteId(message.noteId);
				await completeCalendarItem(message.noteId);
				return { ok: true, calendar: await buildCalendarData() };
			}

			case 'updateMemo': {
				assertNoteId(message.noteId);
				const current = await getTrackedNote(message.noteId);
				const due = parseCalendarDue(message.due);
				const end = message.end ? parseCalendarDue(message.end) : undefined;
				const nextOptions: CalendarOptions = {
					...current.options, allDay: Boolean(message.allDay), recurring: Boolean(message.recurring),
					timeZone: message.timeZone || 'floating', secondaryTimeZone: message.secondaryTimeZone,
					rrule: normalizeRRule(message.rrule, due), reminders: message.reminders ?? [],
					calendarName: message.calendarName || 'Reviews', color: message.color,
					visibility: message.visibility ?? 'edit', attendees: message.attendees ?? [],
					location: message.location, meetingUrl: message.meetingUrl,
					plannedMinutes: Number(message.plannedMinutes) || current.options.plannedMinutes,
				};
				if (message.editScope === 'occurrence' && current.options.rrule && message.occurrenceStart) {
					const excludedDates = [...new Set([...current.options.excludedDates, message.occurrenceStart])];
					await writeCalendarOptions(current.id, { ...current.options, excludedDates });
					const tagName = String(await joplin.settings.value(TAG_SETTING));
					const detached = await createCalendarMemo({ title: message.title, memo: message.memo, due, end, allDay: Boolean(message.allDay), recurring: Boolean(message.recurring), tagName, timeZone: nextOptions.timeZone, secondaryTimeZone: nextOptions.secondaryTimeZone, reminders: nextOptions.reminders, calendarName: nextOptions.calendarName, color: nextOptions.color, visibility: nextOptions.visibility, attendees: nextOptions.attendees, location: nextOptions.location, meetingUrl: nextOptions.meetingUrl, isTask: true, plannedMinutes: nextOptions.plannedMinutes });
					return { ok: true, review: toReviewPayload(detached), calendar: await buildCalendarData() };
				}
				const note = await updateCalendarMemo(message.noteId, {
					title: message.title, memo: message.memo, due, end,
					options: nextOptions,
				});
				return { ok: true, review: toReviewPayload(note), calendar: await buildCalendarData() };
			}

			case 'createMemo': {
				const due = parseCalendarDue(message.due);
				const end = message.end ? parseCalendarDue(message.end) : undefined;
				if (end && end <= due) throw new Error('The event must end after it starts.');
				const rrule = normalizeRRule(message.rrule, due);
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				const note = await createCalendarMemo({
					title: String(message.title ?? ''),
					memo: String(message.memo ?? ''),
					due,
					allDay: Boolean(message.allDay),
					recurring: Boolean(message.recurring),
					tagName,
					end,
					timeZone: message.timeZone,
					secondaryTimeZone: message.secondaryTimeZone,
					rrule,
					reminders: message.reminders,
					calendarName: message.calendarName,
					color: message.color,
					visibility: message.visibility,
					attendees: message.attendees,
					location: message.location,
					meetingUrl: message.meetingUrl,
					isTask: message.isTask,
					plannedMinutes: message.plannedMinutes,
				});
				return { ok: true, review: toReviewPayload(note), calendar: await buildCalendarData() };
			}

			case 'repairData': {
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				const notes = await fetchTrackedNotes(tagName);
				for (const note of notes) {
					await writeCard(note.id, note.card);
					await writeCalendarOptions(note.id, note.options);
				}
				return { ok: true, count: notes.length, calendar: await buildCalendarData() };
			}

			case 'exportBackup': {
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				const notes = await fetchTrackedNotes(tagName);
				const text = JSON.stringify({ format: 'joplin-fsrs-calendar', version: 1, exportedAt: new Date().toISOString(), notes: notes.map(note => ({ id: note.id, title: note.title, memo: note.memo, card: storedCard(note.card), options: note.options })) }, null, 2);
				return { ok: true, count: notes.length, text };
			}

			case 'importBackup': {
				const imported = await importBackup(String(message.text ?? ''));
				return { ok: true, count: imported, calendar: await buildCalendarData() };
			}

			case 'createSample': {
				const due = new Date(); due.setDate(due.getDate() + 3); due.setHours(12, 0, 0, 0);
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				await createCalendarMemo({ title: 'Welcome to review planning', memo: 'Study this sample topic, then choose Again or Good. You can delete this note at any time.', due, allDay: true, recurring: true, tagName, calendarName: 'Reviews', color: '#3578d4', isTask: true, plannedMinutes: 30 });
				return { ok: true, calendar: await buildCalendarData() };
			}

			case 'exportIcs': {
				if (isMobile) throw new Error('Copying an .ics file is currently available on desktop only.');
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				const notes = await fetchTrackedNotes(tagName);
				const text = exportCalendarIcs(notes);
				await joplin.clipboard.writeText(text);
				return { ok: true, count: notes.length };
			}

			case 'importIcs': {
				const tagName = String(await joplin.settings.value(TAG_SETTING));
				const imported = await importCalendarIcs(String(message.text ?? ''), tagName);
				return { ok: true, count: imported, calendar: await buildCalendarData() };
			}

			default:
				throw new Error('Unsupported calendar message.');
		}
	} catch (error) {
		const messageText = error instanceof Error ? error.message : String(error);
		console.error('FSRS Review Calendar:', error);
		return { ok: false, error: messageText };
	}
}

function scheduleRefresh(delay = 350): void {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		refreshTimer = undefined;
		void refreshCalendar();
	}, delay);
}

async function refreshCalendar(): Promise<void> {
	if (activeRefresh) {
		refreshAgain = true;
		return activeRefresh;
	}

	activeRefresh = (async () => {
		do {
			refreshAgain = false;
			try {
				await postToCalendarViews(await buildCalendarData());
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('FSRS Review Calendar refresh failed:', error);
				await postToCalendarViews({ type: 'calendarError', error: message });
			}
		} while (refreshAgain);
	})().finally(() => {
		activeRefresh = null;
	});

	return activeRefresh;
}

async function postToCalendarViews(message: unknown): Promise<void> {
	for (const handle of readyEditorHandles) {
		try {
			await joplin.views.editors.postMessage(handle, message);
		} catch (error) {
			readyEditorHandles.delete(handle);
			console.warn('FSRS Review Calendar: removing an unavailable editor handle.', error);
		}
	}
	for (const handle of readyPanelHandles) {
		try {
			await joplin.views.panels.postMessage(handle, message);
		} catch (error) {
			readyPanelHandles.delete(handle);
			console.warn('FSRS Review Calendar: removing an unavailable panel handle.', error);
		}
	}
}

async function buildCalendarData(): Promise<{ type: 'calendarData'; events: CalendarEvent[]; tagName: string; platform: 'desktop' | 'mobile'; preset: IntervalPreset; dailyCapacityMinutes: number; truncated: boolean; insights: ReturnType<typeof buildInsights> }> {
	const tagName = String(await joplin.settings.value(TAG_SETTING));
	const [notes, todos] = await Promise.all([fetchTrackedNotes(tagName), fetchIncompleteTodos()]);
	const trackedIds = new Set(notes.map(note => note.id));
	let events = notes.flatMap(note => [toCalendarEvent(note), toCreationEvent(note)]);
	for (const todo of todos) {
		if (!trackedIds.has(todo.id)) events.push(toAgendaTodoEvent(todo));
	}
	const reduced = Boolean(await joplin.settings.value(REDUCED_DATA_SETTING));
	const truncated = reduced && events.length > 500;
	if (truncated) events = events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).slice(0, 500);
	const dailyCapacityMinutes = Math.max(30, Number(await joplin.settings.value(DAILY_CAPACITY_SETTING)) || 240);
	return { type: 'calendarData', events, tagName, platform: isMobile ? 'mobile' : 'desktop', preset: intervalPreset, dailyCapacityMinutes, truncated, insights: buildInsights(notes) };
}

function buildInsights(notes: TrackedNote[]) {
	const weekAgo = Date.now() - 7 * 86_400_000;
	const history = notes.flatMap(note => note.options.history.map(item => ({ ...item, title: note.title })));
	const recent = history.filter(item => new Date(item.at).getTime() >= weekAgo && ['again', 'good'].includes(item.action));
	const again = recent.filter(item => item.action === 'again');
	const difficult = Object.entries(again.reduce<Record<string, number>>((map, item) => { map[item.title] = (map[item.title] ?? 0) + 1; return map; }, {}))
		.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, count]) => ({ title, count }));
	const heatmap = history.filter(item => ['again', 'good'].includes(item.action)).reduce<Record<string, number>>((map, item) => { const key = item.at.slice(0, 10); map[key] = (map[key] ?? 0) + 1; return map; }, {});
	const minutesStudied = recent.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
	const forecast = Array.from({ length: 7 }, (_, offset) => {
		const date = new Date(); date.setDate(date.getDate() + offset); const key = localDateKey(date);
		return { date: key, count: notes.filter(note => localDateKey(note.card.due) === key).length };
	});
	const minutesByCalendar = Object.entries(notes.reduce<Record<string, number>>((map, note) => {
		map[note.options.calendarName] = (map[note.options.calendarName] ?? 0) + note.options.history.filter(item => new Date(item.at).getTime() >= weekAgo).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
		return map;
	}, {})).sort((a, b) => b[1] - a[1]);
	return { reviewsThisWeek: recent.length, againRate: recent.length ? Math.round(again.length / recent.length * 100) : 0, difficult, heatmap, minutesStudied, forecast, minutesByCalendar };
}

async function reviewPayload(noteId: string): Promise<ReturnType<typeof toReviewPayload>> {
	const note = await getTrackedNote(noteId);
	return toReviewPayload(note);
}

function toReviewPayload(note: TrackedNote) {
	return {
		noteId: note.id,
		title: note.title,
		memo: note.memo,
		recurring: note.options.recurring,
		allDay: note.options.allDay,
		stability: note.card.stability,
		reps: note.card.reps,
		due: note.card.due.toISOString(),
		intervals: previewIntervals(note.card, new Date(), intervalPreset),
		options: note.options,
	};
}

function toCalendarEvent(note: TrackedNote): CalendarEvent {
	const status = dueStatus(note.card.due);
	const color = note.options.color ?? (status === 'overdue' ? '#d84a4a' : status === 'today' ? '#2e9d61' : '#3578d4');
	const fixedRRule = note.options.rrule ? withDtStart(note.options.rrule, note.card.due, note.options.allDay) : undefined;
	const title = note.options.visibility === 'freebusy' ? 'Busy' : note.title;
	return {
		id: note.id,
		title,
		start: note.options.allDay ? localDateKey(note.card.due) : note.card.due.toISOString(),
		end: note.options.end,
		rrule: fixedRRule,
		exdate: note.options.excludedDates,
		duration: note.options.end ? durationIso(note.card.due, new Date(note.options.end)) : undefined,
		allDay: note.options.allDay,
		backgroundColor: color,
		borderColor: color,
		extendedProps: {
			noteId: note.id,
			memo: note.memo,
			recurring: note.options.recurring,
			allDay: note.options.allDay,
			status,
			stability: note.card.stability,
			reps: note.card.reps,
			intervals: previewIntervals(note.card, new Date(), intervalPreset),
			options: note.options,
			trackedReview: true,
		},
	};
}

function toCreationEvent(note: TrackedNote): CalendarEvent {
	const created = Number.isNaN(note.createdTime.getTime()) ? note.card.due : note.createdTime;
	const color = '#7c5cc4';
	return {
		id: `${note.id}:created`,
		title: `Created · ${note.title}`,
		start: localDateKey(created),
		allDay: true,
		backgroundColor: color,
		borderColor: color,
		editable: false,
		startEditable: false,
		durationEditable: false,
		extendedProps: {
			noteId: note.id,
			memo: note.memo,
			recurring: false,
			allDay: true,
			status: dueStatus(created),
			options: { ...note.options, calendarName: 'Study history', recurring: false },
			trackedReview: true,
			historyMarker: 'created',
			originalDue: created.toISOString(),
		},
	};
}

function toAgendaTodoEvent(todo: Awaited<ReturnType<typeof fetchIncompleteTodos>>[number]): CalendarEvent {
	const due = todo.due;
	const undated = !due || Number.isNaN(due.getTime());
	const displayDate = undated ? new Date() : due;
	const overdue = !undated && displayDate.getTime() < Date.now();
	const status = overdue ? 'overdue' : dueStatus(displayDate);
	const color = overdue ? '#d84a4a' : '#65758b';
	return {
		id: todo.id,
		title: todo.title,
		start: undated ? localDateKey(displayDate) : displayDate.toISOString(),
		allDay: undated,
		backgroundColor: color,
		borderColor: color,
		extendedProps: {
			noteId: todo.id,
			memo: todo.memo,
			recurring: false,
			allDay: undated,
			status,
			trackedReview: false,
			agendaOnly: true,
			undated,
			originalDue: due?.toISOString(),
			options: {
				recurring: false,
				allDay: undated,
				timeZone: 'floating',
				reminders: [],
				calendarName: 'Joplin To-dos',
				visibility: 'edit',
				attendees: [],
				isTask: true,
				completed: false,
				history: [],
				excludedDates: [],
				plannedMinutes: 60,
			},
		},
	};
}

async function checkDesktopReminders(): Promise<void> {
	try {
		const tagName = String(await joplin.settings.value(TAG_SETTING));
		const notes = await fetchTrackedNotes(tagName);
		const now = Date.now();
		for (const note of notes) {
			for (const reminder of note.options.reminders) {
				if (reminder.channel !== 'desktop') continue;
				const trigger = note.card.due.getTime() - reminder.offsetMinutes * 60_000;
				const key = `${note.id}:${note.card.due.toISOString()}:${reminder.offsetMinutes}`;
				if (now >= trigger && now - trigger < 90_000 && !deliveredReminders.has(key)) {
					deliveredReminders.add(key);
					await joplin.views.dialogs.showToast({
						message: `${note.title} is ${reminder.offsetMinutes ? `due in ${formatOffset(reminder.offsetMinutes)}` : 'due now'}`,
						type: ToastType.Info,
						duration: 10_000,
					});
				}
			}
		}
	} catch (error) {
		console.warn('FSRS Review Calendar reminder check failed:', error);
	}
}

function normalizeRRule(value: unknown, due: Date): string | undefined {
	const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
	if (!text) return undefined;
	const rule = text.startsWith('RRULE:') ? text : `RRULE:${text}`;
	try {
		rrulestr(withDtStart(rule, due, false));
		return rule;
	} catch {
		throw new Error('The recurrence rule is not a valid RFC 5545 RRULE.');
	}
}

function withDtStart(rrule: string, due: Date, allDay: boolean): string {
	if (/^DTSTART/im.test(rrule)) return rrule;
	const stamp = allDay ? localDateKey(due).replace(/-/g, '') : icsDate(due);
	return `DTSTART:${stamp}\n${rrule}`;
}

function durationIso(start: Date, end: Date): string | undefined {
	const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
	return minutes > 0 ? `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:00` : undefined;
}

function shiftEndWithStart(options: CalendarOptions, oldStart: Date, newStart: Date): CalendarOptions {
	if (!options.end) return options;
	const oldEnd = new Date(options.end);
	const duration = oldEnd.getTime() - oldStart.getTime();
	if (!Number.isFinite(duration) || duration <= 0) return { ...options, end: undefined };
	return { ...options, end: new Date(newStart.getTime() + duration).toISOString() };
}

function exportCalendarIcs(notes: TrackedNote[]): string {
	const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joplin FSRS Review Calendar//EN', 'CALSCALE:GREGORIAN'];
	for (const note of notes) {
		lines.push('BEGIN:VEVENT', `UID:${note.id}@joplin-fsrs`, `DTSTAMP:${icsDate(new Date())}`);
		if (note.options.allDay) lines.push(`DTSTART;VALUE=DATE:${localDateKey(note.card.due).replace(/-/g, '')}`);
		else lines.push(`DTSTART:${icsDate(note.card.due)}`);
		if (note.options.end) lines.push(`DTEND:${icsDate(new Date(note.options.end))}`);
		lines.push(`SUMMARY:${icsEscape(note.title)}`);
		if (note.memo) lines.push(`DESCRIPTION:${icsEscape(note.memo)}`);
		if (note.options.location) lines.push(`LOCATION:${icsEscape(note.options.location)}`);
		if (note.options.rrule) lines.push(note.options.rrule.startsWith('RRULE:') ? note.options.rrule : `RRULE:${note.options.rrule}`);
		for (const attendee of note.options.attendees) lines.push(`ATTENDEE;PARTSTAT=${attendee.status.toUpperCase().replace('-', '')}:mailto:${attendee.email}`);
		lines.push('END:VEVENT');
	}
	return `${lines.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

async function importCalendarIcs(text: string, tagName: string): Promise<number> {
	const unfolded = text.replace(/\r?\n[ \t]/g, '');
	const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
	for (const block of blocks) {
		const property = (name: string) => block.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'mi'))?.[1]?.trim();
		const rawStart = property('DTSTART');
		if (!rawStart) continue;
		const due = parseIcsDate(rawStart);
		const rawEnd = property('DTEND');
		await createCalendarMemo({
			title: icsUnescape(property('SUMMARY') || 'Imported event'),
			memo: icsUnescape(property('DESCRIPTION') || ''),
			due,
			end: rawEnd ? parseIcsDate(rawEnd) : undefined,
			allDay: /^DTSTART;VALUE=DATE/im.test(block) || /^\d{8}$/.test(rawStart),
			recurring: false,
			tagName,
			rrule: property('RRULE') ? `RRULE:${property('RRULE')}` : undefined,
			location: icsUnescape(property('LOCATION') || ''),
		});
	}
	return blocks.length;
}

async function importBackup(text: string): Promise<number> {
	let value: unknown;
	try { value = JSON.parse(text); } catch { throw new Error('The backup is not valid JSON.'); }
	if (!value || typeof value !== 'object' || (value as Record<string, unknown>).format !== 'joplin-fsrs-calendar') throw new Error('This is not an FSRS Review Calendar backup.');
	const entries = (value as { notes?: unknown[] }).notes;
	if (!Array.isArray(entries)) throw new Error('The backup does not contain calendar notes.');
	const tagName = String(await joplin.settings.value(TAG_SETTING));
	const existing = await fetchTrackedNotes(tagName);
	const signatures = new Set(existing.map(note => `${note.title}\n${note.card.due.toISOString()}`));
	let imported = 0;
	for (const raw of entries.slice(0, 5000)) {
		if (!raw || typeof raw !== 'object') continue;
		const item = raw as Record<string, unknown>;
		const title = String(item.title ?? '').trim();
		const cardValue = item.card as Parameters<typeof restoreStoredCard>[0];
		if (!title || !cardValue) continue;
		let card;
		try { card = restoreStoredCard(cardValue); } catch { continue; }
		const signature = `${title}\n${card.due.toISOString()}`;
		if (signatures.has(signature)) continue;
		const sourceOptions = item.options && typeof item.options === 'object' ? item.options as CalendarOptions : undefined;
		const note = await createCalendarMemo({
			title, memo: String(item.memo ?? ''), due: card.due, allDay: sourceOptions?.allDay !== false,
			recurring: sourceOptions?.recurring !== false, tagName, end: sourceOptions?.end ? new Date(sourceOptions.end) : undefined,
			timeZone: sourceOptions?.timeZone, secondaryTimeZone: sourceOptions?.secondaryTimeZone, rrule: sourceOptions?.rrule,
			reminders: sourceOptions?.reminders, calendarName: sourceOptions?.calendarName, color: sourceOptions?.color,
			visibility: sourceOptions?.visibility, attendees: sourceOptions?.attendees, location: sourceOptions?.location,
			meetingUrl: sourceOptions?.meetingUrl, isTask: true, plannedMinutes: sourceOptions?.plannedMinutes,
		});
		await writeCard(note.id, card);
		if (sourceOptions) await writeCalendarOptions(note.id, sourceOptions);
		signatures.add(signature);
		imported += 1;
	}
	return imported;
}

function parseIcsDate(value: string): Date {
	if (/^\d{8}$/.test(value)) return new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), 12);
	const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
	if (!match) throw new Error(`Unsupported iCalendar date: ${value}`);
	const [, y, m, d, h, min, s, z] = match;
	return z ? new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s)) : new Date(+y, +m - 1, +d, +h, +min, +s);
}

function icsDate(date: Date): string {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function icsUnescape(value: string): string { return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function formatOffset(minutes: number): string { return minutes >= 1440 ? `${Math.round(minutes / 1440)} day(s)` : minutes >= 60 ? `${Math.round(minutes / 60)} hour(s)` : `${minutes} minute(s)`; }

function parseCalendarDue(value: string): Date {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const [year, month, day] = value.split('-').map(Number);
		const due = new Date(year, month - 1, day, 12, 0, 0, 0);
		if (due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) {
			throw new Error('The memo date does not exist.');
		}
		return due;
	}
	const due = new Date(value);
	if (Number.isNaN(due.getTime())) throw new Error('The memo date and time are invalid.');
	return due;
}

function dueStatus(due: Date): 'overdue' | 'today' | 'upcoming' {
	const dueKey = localDateKey(due);
	const todayKey = localDateKey(new Date());
	if (dueKey < todayKey) return 'overdue';
	if (dueKey === todayKey) return 'today';
	return 'upcoming';
}

function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function normalizeIntervalPreset(value: unknown): IntervalPreset {
	return ['relaxed', 'standard', 'intensive', 'exam'].includes(String(value)) ? value as IntervalPreset : 'standard';
}

function assertNoteId(noteId: unknown): asserts noteId is string {
	if (typeof noteId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(noteId)) {
		throw new Error('Invalid note identifier.');
	}
}
