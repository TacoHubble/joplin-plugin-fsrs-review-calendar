import { Calendar, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import multiMonthPlugin from '@fullcalendar/multimonth';
import rrulePlugin from '@fullcalendar/rrule';
import timeGridPlugin from '@fullcalendar/timegrid';
import * as chrono from 'chrono-node';

declare const webviewApi: {
	postMessage(message: unknown): Promise<unknown>;
	onMessage(callback: (message: CalendarMessage) => void): void;
};

type Rating = 1 | 3;
type RatingIntervals = Record<Rating, string>;
interface ReviewHistoryEntry { at: string; action: string; previousDue: string; resultingDue: string; minutes?: number; }
interface CalendarOptions { calendarName: string; secondaryTimeZone?: string; location?: string; meetingUrl?: string; visibility: string; isTask: boolean; timeZone?: string; rrule?: string; color?: string; reminders?: Array<{ channel: string; offsetMinutes: number }>; attendees?: Array<{ email: string; status: string }>; history: ReviewHistoryEntry[]; plannedMinutes: number; }
interface ReviewPayload { noteId: string; title: string; memo: string; recurring: boolean; allDay: boolean; stability: number; reps: number; due: string; intervals: RatingIntervals; options: CalendarOptions; }
interface CalendarDataMessage { type: 'calendarData'; events: EventInput[]; tagName: string; platform: 'desktop' | 'mobile'; preset: string; dailyCapacityMinutes: number; truncated: boolean; insights: { reviewsThisWeek: number; againRate: number; difficult: Array<{ title: string; count: number }>; heatmap: Record<string, number>; minutesStudied: number; forecast: Array<{ date: string; count: number }>; minutesByCalendar: Array<[string, number]> }; }
interface CalendarErrorMessage { type: 'calendarError'; error: string; }
type CalendarMessage = CalendarDataMessage | CalendarErrorMessage;
type BackendResponse = { ok: true; review?: ReviewPayload; count?: number; calendar?: CalendarDataMessage; text?: string } | { ok: false; error: string };

const calendarElement = requiredElement('calendar');
const statusElement = requiredElement('status');
const scopeLabel = requiredElement('scope-label');
const reviewPanel = requiredElement('review-panel');
const reviewTitle = requiredElement('review-title');
const reviewStats = requiredElement('review-stats');
const reviewMemo = requiredElement('review-memo');
const recurrenceHint = requiredElement('recurrence-hint');
const reviewRecurrenceControl = requiredElement('review-recurrence-control');
const recurringToggle = input('recurring-toggle');
const ratingButtons = requiredElement('rating-buttons');
const memoModal = requiredElement('memo-modal');
const memoForm = requiredElement('memo-form') as HTMLFormElement;
const memoTitle = input('memo-title');
const memoBody = requiredElement('memo-body') as HTMLTextAreaElement;
const memoDate = input('memo-date');
const memoTime = input('memo-time');
const memoEndTime = input('memo-end-time');
const memoAllDay = input('memo-all-day');
const memoRecurring = input('memo-recurring');
const rrulePreset = select('memo-rrule-preset');
const rruleInput = input('memo-rrule');
const eventSearch = input('event-search');
const quickAdd = input('quick-add');
const displayTimeZone = select('display-time-zone');
const layersElement = requiredElement('calendar-layers');
const agendaFooter = requiredElement('agenda-footer');
const agendaUndated = requiredElement('agenda-undated');
const agendaOverdue = requiredElement('agenda-overdue');
const icsModal = requiredElement('ics-modal');
const icsForm = requiredElement('ics-form') as HTMLFormElement;
const icsText = requiredElement('ics-text') as HTMLTextAreaElement;
const todayDashboard = requiredElement('today-dashboard');
const insightsPanel = requiredElement('insights-panel');
const dataModal = requiredElement('data-modal');
const backupText = requiredElement('backup-text') as HTMLTextAreaElement;
const reviewHistory = requiredElement('review-history');

let selectedNoteId: string | null = null;
let previousDateClick: { key: string; timestamp: number } | null = null;
let allEvents: EventInput[] = [];
let mobileMode = false;
let editingNoteId: string | null = null;
let latestCalendarData: CalendarDataMessage | null = null;
let focusQueue: string[] = [];
let currentReview: ReviewPayload | null = null;
let selectedOccurrenceStart: string | null = null;
let focusStartedAt = 0;
const hiddenLayers = new Set<string>();

const calendar = new Calendar(calendarElement, {
	plugins: [dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, rrulePlugin, interactionPlugin],
	initialView: 'dayGridMonth',
	height: calendarViewportHeight(),
	expandRows: false,
	stickyHeaderDates: true,
	nowIndicator: true,
	editable: true,
	eventStartEditable: true,
	eventDurationEditable: true,
	displayEventTime: true,
	displayEventEnd: true,
	forceEventDuration: true,
	defaultTimedEventDuration: '01:00:00',
	defaultAllDayEventDuration: { days: 1 },
	allDaySlot: true,
	dayMaxEvents: true,
	slotDuration: '00:30:00',
	scrollTime: '07:00:00',
	scrollTimeReset: false,
	longPressDelay: 450,
	eventLongPressDelay: 450,
	selectLongPressDelay: 450,
	headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridThreeDay,timeGridWeek,dayGridMonth,multiMonthYear,listAgenda' },
	views: {
		timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 Day' },
		listAgenda: { type: 'list', duration: { years: 50 }, buttonText: 'Agenda' },
	},
	buttonText: { day: 'Day', week: 'Week', month: 'Month', year: 'Year', list: 'Agenda' },
	dateClick: handleDateClick,
	eventClick: (argument: EventClickArg) => void openCalendarEvent(argument),
	eventDrop: (argument: EventDropArg) => void updateTiming(argument),
	eventResize: (argument: EventResizeDoneArg) => void updateTiming(argument),
	eventContent: renderEventContent,
	datesSet: () => { applyEventFilters(); renderAgendaFooter(); localStorage.setItem(`fsrs-calendar-view-${mobileMode ? 'mobile' : 'desktop'}`, calendar.view.type); },
});
calendar.render();

let calendarResizeFrame = 0;
window.addEventListener('resize', () => {
	resizeCalendarSoon();
});

webviewApi.onMessage(message => {
	if (message.type === 'calendarData') {
		applyCalendarData(message);
	} else setStatus(message.error, true);
});

requiredElement('refresh-button').addEventListener('click', () => void refresh());
requiredElement('today-button').addEventListener('click', () => { renderTodayDashboard(); todayDashboard.hidden = false; resizeCalendarSoon(); todayDashboard.scrollIntoView({ behavior: 'smooth' }); });
requiredElement('close-today').addEventListener('click', () => { todayDashboard.hidden = true; resizeCalendarSoon(); });
requiredElement('insights-button').addEventListener('click', () => { renderInsights(); insightsPanel.hidden = false; resizeCalendarSoon(); insightsPanel.scrollIntoView({ behavior: 'smooth' }); });
requiredElement('close-insights').addEventListener('click', () => { insightsPanel.hidden = true; resizeCalendarSoon(); });
requiredElement('data-tools-button').addEventListener('click', () => { dataModal.hidden = false; });
requiredElement('close-data').addEventListener('click', () => { dataModal.hidden = true; });
dataModal.addEventListener('click', event => { if (event.target === dataModal) dataModal.hidden = true; });
requiredElement('dismiss-onboarding').addEventListener('click', () => { localStorage.setItem('fsrs-calendar-onboarded', '1'); requiredElement('onboarding').hidden = true; resizeCalendarSoon(); });
requiredElement('sample-button').addEventListener('click', async () => { const response = await request({ type: 'createSample' }); if (!response.ok) setStatus(response.error, true); else { localStorage.setItem('fsrs-calendar-onboarded', '1'); requiredElement('onboarding').hidden = true; resizeCalendarSoon(); setStatus('Sample review topic created.'); } });
requiredElement('start-session').addEventListener('click', () => void startFocusSession());
requiredElement('repair-button').addEventListener('click', async () => { const response = await request({ type: 'repairData' }); setStatus(response.ok ? `Repaired ${response.count ?? 0} calendar items.` : response.error, !response.ok); });
requiredElement('backup-export-button').addEventListener('click', async () => { const response = await request({ type: 'exportBackup' }); if (!response.ok) return setStatus(response.error, true); backupText.value = response.text ?? ''; backupText.focus(); backupText.select(); setStatus(`Backup generated for ${response.count ?? 0} items.`); });
requiredElement('backup-import-button').addEventListener('click', async () => { if (!backupText.value.trim()) return setStatus('Paste a backup first.', true); const response = await request({ type: 'importBackup', text: backupText.value }); setStatus(response.ok ? `Imported ${response.count ?? 0} new items; duplicates were skipped.` : response.error, !response.ok); });
requiredElement('export-button').addEventListener('click', async () => {
	const response = await request({ type: 'exportIcs' });
	setStatus(response.ok ? `${response.count ?? 0} events copied as iCalendar.` : response.error, !response.ok);
});
requiredElement('import-button').addEventListener('click', () => { icsModal.hidden = false; icsText.focus(); });
for (const id of ['cancel-ics', 'cancel-ics-icon']) requiredElement(id).addEventListener('click', closeIcs);
icsForm.addEventListener('submit', async event => {
	event.preventDefault();
	const response = await request({ type: 'importIcs', text: icsText.value });
	if (!response.ok) return setStatus(response.error, true);
	closeIcs();
	setStatus(`${response.count ?? 0} iCalendar events imported.`);
});

requiredElement('close-review').addEventListener('click', () => { selectedNoteId = null; reviewPanel.hidden = true; });
requiredElement('snooze-button').addEventListener('click', async () => {
	if (!selectedNoteId) return;
	const raw = window.prompt('Snooze for how many days?', '1');
	if (raw === null) return;
	const days = Number(raw);
	if (!Number.isFinite(days) || days < 1) return setStatus('Enter a positive number of days.', true);
	const response = await request({ type: 'snooze', noteId: selectedNoteId, days });
	if (!response.ok) setStatus(response.error, true); else if (response.review) { renderReview(response.review); setStatus(`Snoozed for ${Math.round(days)} day(s).`); }
});
requiredElement('skip-button').addEventListener('click', async () => {
	if (!selectedNoteId) return;
	const response = await request({ type: 'snooze', noteId: selectedNoteId, days: 1, action: 'skip' });
	if (!response.ok) setStatus(response.error, true); else { if (response.review) renderReview(response.review); setStatus('Skipped today and moved to tomorrow.'); advanceFocusSession(); }
});
requiredElement('undo-button').addEventListener('click', async () => {
	if (!selectedNoteId) return;
	const response = await request({ type: 'undoReview', noteId: selectedNoteId });
	if (!response.ok) setStatus(response.error, true); else if (response.review) { renderReview(response.review); setStatus('Last scheduling action undone.'); }
});
requiredElement('edit-button').addEventListener('click', () => openEditModal());
requiredElement('complete-button').addEventListener('click', async () => {
	if (!selectedNoteId) return;
	const completedNoteId = selectedNoteId;
	const button = requiredElement('complete-button') as HTMLButtonElement;
	button.disabled = true;
	const response = await request({ type: 'complete', noteId: selectedNoteId });
	button.disabled = false;
	if (!response.ok) return setStatus(response.error, true);
	selectedNoteId = null;
	reviewPanel.hidden = true;
	setStatus('To-do completed and removed from the active calendar. Uncheck it in Joplin to restore it.');
	focusQueue = focusQueue.filter(id => id !== completedNoteId);
	advanceFocusSession();
});
recurringToggle.addEventListener('change', async () => {
	if (!selectedNoteId) return;
	const requestedValue = recurringToggle.checked;
	recurringToggle.disabled = true;
	const response = await request({ type: 'setRecurring', noteId: selectedNoteId, recurring: requestedValue });
	recurringToggle.disabled = false;
	if (!response.ok) { recurringToggle.checked = !requestedValue; return setStatus(response.error, true); }
	if (response.review) renderReview(response.review);
	setStatus(requestedValue ? 'FSRS adaptive scheduling enabled.' : 'This is now a one-off item.');
});

ratingButtons.addEventListener('click', async event => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-rating]');
	if (!button || !selectedNoteId) return;
	setReviewButtonsDisabled(true);
	const studiedMinutes = focusStartedAt ? Math.max(1, Math.round((Date.now() - focusStartedAt) / 60_000)) : 0;
	const response = await request({ type: 'rate', noteId: selectedNoteId, rating: Number(button.dataset.rating) as Rating, studiedMinutes });
	setReviewButtonsDisabled(false);
	if (!response.ok) return setStatus(response.error, true);
	if (response.review) renderReview(response.review);
	setStatus('Review scheduled with FSRS.');
	advanceFocusSession();
});

memoAllDay.addEventListener('change', syncMemoTimeState);
rrulePreset.addEventListener('change', () => { rruleInput.hidden = rrulePreset.value !== 'custom'; if (!rruleInput.hidden) rruleInput.focus(); });
for (const id of ['cancel-memo', 'cancel-memo-icon']) requiredElement(id).addEventListener('click', closeMemoModal);
memoModal.addEventListener('click', event => { if (event.target === memoModal) closeMemoModal(); });

memoForm.addEventListener('submit', async event => {
	event.preventDefault();
	if (!memoForm.reportValidity()) return;
	const allDay = memoAllDay.checked;
	const due = allDay ? memoDate.value : new Date(`${memoDate.value}T${memoTime.value || '09:00'}`).toISOString();
	const end = allDay || !memoEndTime.value ? undefined : new Date(`${memoDate.value}T${memoEndTime.value}`).toISOString();
	if (end && new Date(end) <= new Date(due)) return setStatus('End time must be after start time.', true);
	if (!confirmLocalConflict(due, end)) return;
	const offset = select('memo-reminder-offset').value;
	const attendees = input('memo-attendees').value.split(',').map(email => email.trim()).filter(Boolean).map(email => ({ email, status: 'needs-action' }));
	const response = await request({
		type: editingNoteId ? 'updateMemo' : 'createMemo', ...(editingNoteId ? { noteId: editingNoteId } : {}), title: memoTitle.value, memo: memoBody.value, due, end, allDay,
		recurring: memoRecurring.checked,
		rrule: rrulePreset.value === 'custom' ? rruleInput.value : rrulePreset.value,
		timeZone: input('memo-time-zone').value || 'floating',
		secondaryTimeZone: input('memo-secondary-time-zone').value,
		calendarName: input('memo-calendar-name').value || 'Reviews',
		color: input('memo-color').value,
		visibility: select('memo-visibility').value,
		reminders: offset ? [{ channel: select('memo-reminder-channel').value, offsetMinutes: Number(offset) }] : [],
		location: input('memo-location').value,
		meetingUrl: input('memo-meeting-url').value,
		attendees,
		isTask: true,
		plannedMinutes: Number(input('memo-planned-minutes').value) || 60,
		editScope: select('edit-scope').value,
		occurrenceStart: selectedOccurrenceStart ?? undefined,
	});
	if (!response.ok) return setStatus(response.error, true);
	const wasEditing = Boolean(editingNoteId);
	closeMemoModal();
	if (response.review) renderReview(response.review);
	setStatus(wasEditing ? 'Calendar item updated.' : 'Calendar item added.');
});

eventSearch.addEventListener('input', applyEventFilters);
displayTimeZone.addEventListener('change', () => { calendar.setOption('timeZone', displayTimeZone.value); setStatus(`Showing ${displayTimeZone.selectedOptions[0].text}.`); });
quickAdd.addEventListener('keydown', event => {
	if (event.key !== 'Enter' || !quickAdd.value.trim()) return;
	event.preventDefault();
	const result = chrono.parse(quickAdd.value, new Date(), { forwardDate: true })[0];
	const date = result?.start.date() ?? new Date();
	openMemoModalForDate(date, !result?.start.isCertain('hour'));
	if (result?.end) memoEndTime.value = localTimeValue(result.end.date());
	memoTitle.value = result ? `${quickAdd.value.slice(0, result.index)} ${quickAdd.value.slice(result.index + result.text.length)}`.replace(/\s+/g, ' ').trim() : quickAdd.value.trim();
	quickAdd.value = '';
});

document.addEventListener('keydown', event => {
	if (event.key === 'Escape') {
		if (!memoModal.hidden) closeMemoModal();
		else if (!icsModal.hidden) closeIcs();
		else if (!dataModal.hidden) dataModal.hidden = true;
		else if (!reviewPanel.hidden) { selectedNoteId = null; reviewPanel.hidden = true; }
		return;
	}
	if (!memoModal.hidden || !icsModal.hidden || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return;
	const views: Record<string, string> = { d: 'timeGridDay', w: 'timeGridWeek', m: 'dayGridMonth', y: 'multiMonthYear', a: 'listAgenda' };
	const key = event.key.toLowerCase();
	if (key === '/') { event.preventDefault(); eventSearch.focus(); }
	else if (key === 't') calendar.today();
	else if (views[key]) calendar.changeView(views[key]);
});

void request({ type: 'ready' }).then(response => { if (!response.ok) setStatus(response.error, true); });

function handleDateClick(argument: DateClickArg): void {
	if (mobileMode) {
		openMemoModalForDate(argument.date, argument.allDay);
		return;
	}
	const key = `${argument.dateStr}|${argument.allDay}`;
	const timestamp = Date.now();
	if (previousDateClick?.key === key && timestamp - previousDateClick.timestamp <= 500) { previousDateClick = null; openMemoModalForDate(argument.date, argument.allDay); }
	else previousDateClick = { key, timestamp };
}

function openMemoModalForDate(date: Date, allDay: boolean): void {
	editingNoteId = null;
	selectedOccurrenceStart = null;
	requiredElement('edit-scope-control').hidden = true;
	memoForm.reset();
	requiredElement('memo-form-title').textContent = 'Add a memo';
	requiredElement('save-memo').textContent = 'Add to calendar';
	memoDate.value = localDateKey(date);
	memoAllDay.checked = allDay;
	memoRecurring.checked = true;
	memoTime.value = allDay ? '' : localTimeValue(date);
	memoEndTime.value = allDay ? '' : localTimeValue(new Date(date.getTime() + 60 * 60_000));
	input('memo-calendar-name').value = 'Reviews';
	input('memo-color').value = '#3578d4';
	input('memo-time-zone').value = 'floating';
	rruleInput.hidden = true;
	syncMemoTimeState();
	memoModal.hidden = false;
	memoTitle.focus();
}

function closeMemoModal(): void { memoModal.hidden = true; memoForm.reset(); editingNoteId = null; }

function openEditModal(): void {
	if (!currentReview) return;
	editingNoteId = currentReview.noteId;
	memoForm.reset();
	requiredElement('memo-form-title').textContent = 'Edit calendar item';
	requiredElement('save-memo').textContent = 'Save changes';
	memoTitle.value = currentReview.title;
	memoBody.value = currentReview.memo;
	const occurrenceDate = currentReview.options.rrule && selectedOccurrenceStart ? selectedOccurrenceStart : currentReview.due;
	const due = new Date(occurrenceDate);
	memoDate.value = localDateKey(due);
	memoAllDay.checked = currentReview.allDay;
	memoTime.value = currentReview.allDay ? '' : localTimeValue(due);
	memoEndTime.value = '';
	memoRecurring.checked = currentReview.recurring;
	input('memo-calendar-name').value = currentReview.options.calendarName || 'Reviews';
	input('memo-color').value = currentReview.options.color || '#3578d4';
	input('memo-time-zone').value = currentReview.options.timeZone || 'floating';
	input('memo-secondary-time-zone').value = currentReview.options.secondaryTimeZone || '';
	input('memo-location').value = currentReview.options.location || '';
	input('memo-meeting-url').value = currentReview.options.meetingUrl || '';
	input('memo-attendees').value = (currentReview.options.attendees ?? []).map(item => item.email).join(', ');
	input('memo-planned-minutes').value = String(currentReview.options.plannedMinutes || 60);
	select('memo-visibility').value = currentReview.options.visibility || 'edit';
	const rule = currentReview.options.rrule?.replace(/^RRULE:/, '') ?? '';
	requiredElement('edit-scope-control').hidden = !rule;
	const presets = Array.from(rrulePreset.options).map(option => option.value);
	rrulePreset.value = presets.includes(rule) ? rule : rule ? 'custom' : '';
	rruleInput.value = rule;
	rruleInput.hidden = rrulePreset.value !== 'custom';
	syncMemoTimeState();
	memoModal.hidden = false;
	memoTitle.focus();
}
function closeIcs(): void { icsModal.hidden = true; icsForm.reset(); }
function syncMemoTimeState(): void { memoTime.disabled = memoAllDay.checked; memoEndTime.disabled = memoAllDay.checked; if (!memoAllDay.checked && !memoTime.value) memoTime.value = '09:00'; }

async function openCalendarEvent(argument: EventClickArg): Promise<void> {
	if (argument.event.extendedProps.historyMarker) {
		const noteId = String(argument.event.extendedProps.noteId ?? argument.event.id);
		const response = await request({ type: 'openTodo', noteId });
		setStatus(response.ok ? `Opened note created ${formatAgendaDate(String(argument.event.extendedProps.originalDue ?? argument.event.start?.toISOString() ?? ''))}.` : response.error, !response.ok);
		return;
	}
	if (argument.event.extendedProps.trackedReview === false) {
		const noteId = String(argument.event.extendedProps.noteId ?? argument.event.id);
		renderTodoPanel(noteId, argument.event.title, String(argument.event.extendedProps.memo ?? ''), argument.event.extendedProps.originalDue as string | undefined);
		const response = await request({ type: 'openTodo', noteId });
		if (!response.ok) setStatus(response.error, true);
		return;
	}
	await openReview(argument);
}

async function openReview(argument: EventClickArg): Promise<void> {
	const noteId = String(argument.event.extendedProps.noteId ?? argument.event.id);
	selectedOccurrenceStart = argument.event.start?.toISOString() ?? null;
	selectedNoteId = noteId;
	const response = await request({ type: 'openReview', noteId });
	if (!response.ok) return setStatus(response.error, true);
	if (response.review && selectedNoteId === noteId) renderReview(response.review);
}

async function updateTiming(argument: EventDropArg | EventResizeDoneArg): Promise<void> {
	const start = argument.event.start;
	if (!start) return argument.revert();
	const response = await request({ type: 'updateTiming', noteId: String(argument.event.extendedProps.noteId ?? argument.event.id), start: argument.event.allDay ? localDateKey(start) : start.toISOString(), end: argument.event.end?.toISOString(), allDay: Boolean(argument.event.allDay) });
	if (!response.ok) { argument.revert(); return setStatus(response.error, true); }
	setStatus('Calendar item timing updated.');
}

function renderReview(review: ReviewPayload): void {
	currentReview = review;
	(requiredElement('edit-button') as HTMLButtonElement).disabled = false;
	requiredElement('history-details').hidden = false;
	selectedNoteId = review.noteId;
	reviewTitle.textContent = `${review.options.isTask ? '☐ ' : ''}${review.title}`;
	reviewStats.textContent = `Stability ${formatStability(review.stability)} · ${review.reps} review${review.reps === 1 ? '' : 's'} · ${review.options.calendarName}`;
	reviewMemo.textContent = [review.memo, review.options.location ? `📍 ${review.options.location}` : '', review.options.meetingUrl ?? ''].filter(Boolean).join('\n');
	reviewMemo.hidden = !reviewMemo.textContent;
	recurringToggle.checked = review.recurring;
	reviewRecurrenceControl.hidden = false;
	reviewPanel.hidden = false;
	if (review.recurring) {
		recurrenceHint.textContent = 'Again returns the topic soon; Good expands it toward week-scale reviews.';
		ratingButtons.replaceChildren(createRatingButton(1, 'Again', review.intervals[1]), createRatingButton(3, 'Good', review.intervals[3]));
	} else { recurrenceHint.textContent = 'One-off item. Turn on FSRS repeats to schedule it after review.'; ratingButtons.replaceChildren(); }
	reviewHistory.replaceChildren(...(review.options.history ?? []).slice().reverse().map(item => {
		const row = document.createElement('div'); row.className = 'history-row';
		row.textContent = `${new Date(item.at).toLocaleString()} · ${item.action}${item.minutes ? ` · ${item.minutes} min` : ''} · next ${new Date(item.resultingDue).toLocaleDateString()}`;
		return row;
	}));
	(requiredElement('undo-button') as HTMLButtonElement).disabled = !(review.options.history?.length);
	reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTodoPanel(noteId: string, title: string, memo: string, due?: string): void {
	currentReview = null;
	(requiredElement('edit-button') as HTMLButtonElement).disabled = true;
	(requiredElement('undo-button') as HTMLButtonElement).disabled = true;
	requiredElement('history-details').hidden = true;
	selectedNoteId = noteId;
	reviewTitle.textContent = `☐ ${title}`;
	reviewStats.textContent = due ? `Joplin to-do · Due ${formatAgendaDate(due)}` : 'Joplin to-do · No due date';
	reviewMemo.textContent = memo;
	reviewMemo.hidden = !memo;
	reviewRecurrenceControl.hidden = true;
	recurrenceHint.textContent = 'This to-do appears automatically in Agenda. Complete it to remove it.';
	ratingButtons.replaceChildren();
	reviewPanel.hidden = false;
	reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTodayDashboard(): void {
	if (!latestCalendarData) return;
	const today = localDateKey(new Date());
	const events = allEvents.filter(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		return !hiddenLayers.has(String(props?.options?.calendarName ?? 'Reviews'));
	});
	const dueReviews = events.filter(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		return props?.trackedReview && !props?.historyMarker && String(event.start ?? '').slice(0, 10) <= today;
	}).sort((a, b) => eventDueValue(a) - eventDueValue(b));
	const scheduled = events.filter(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		return !props?.historyMarker && !props?.undated && props?.status === 'today' && !dueReviews.includes(event);
	});
	const overdue = events.filter(event => { const props = event.extendedProps as Record<string, any> | undefined; return !props?.historyMarker && props?.status === 'overdue' && !dueReviews.includes(event); });
	const unscheduled = events.filter(event => Boolean((event.extendedProps as Record<string, any> | undefined)?.undated));
	renderDashboardList('today-reviews', dueReviews);
	renderDashboardList('today-events', scheduled);
	renderDashboardList('today-overdue', overdue);
	renderDashboardList('today-unscheduled', unscheduled);
	const planned = [...dueReviews, ...scheduled].reduce((sum, event) => sum + Number((event.extendedProps as Record<string, any> | undefined)?.options?.plannedMinutes ?? 60), 0);
	const capacity = latestCalendarData.dailyCapacityMinutes;
	const label = requiredElement('capacity-label');
	label.textContent = `${planned} min planned · ${capacity} min capacity${planned > capacity ? ` · ${planned - capacity} min overloaded` : ''}`;
	label.classList.toggle('is-overloaded', planned > capacity);
	(requiredElement('start-session') as HTMLButtonElement).disabled = dueReviews.length === 0;
}

function renderDashboardList(id: string, events: EventInput[]): void {
	const container = requiredElement(id);
	if (!events.length) { const empty = document.createElement('p'); empty.className = 'helper-text'; empty.textContent = 'Nothing here.'; container.replaceChildren(empty); return; }
	container.replaceChildren(...events.map(event => createDashboardItem(event)));
}

function createDashboardItem(event: EventInput): HTMLButtonElement {
	const props = event.extendedProps as Record<string, any> | undefined;
	const button = document.createElement('button'); button.type = 'button'; button.className = 'agenda-item';
	const time = document.createElement('time'); time.textContent = props?.undated ? 'Unscheduled' : formatAgendaDate(String(props?.originalDue ?? event.start ?? ''));
	const title = document.createElement('strong'); title.textContent = String(event.title ?? 'Untitled');
	button.append(time, title); button.addEventListener('click', () => void openEventByInput(event));
	let touchX = 0;
	button.addEventListener('touchstart', e => { touchX = e.changedTouches[0]?.clientX ?? 0; }, { passive: true });
	button.addEventListener('touchend', e => { const delta = (e.changedTouches[0]?.clientX ?? touchX) - touchX; const noteId = String(props?.noteId ?? event.id ?? ''); if (delta < -70) void quickComplete(noteId); else if (delta > 70) void quickSnooze(noteId); }, { passive: true });
	return button;
}

async function openEventByInput(event: EventInput): Promise<void> {
	const props = event.extendedProps as Record<string, any> | undefined;
	const noteId = String(props?.noteId ?? event.id ?? '');
	if (props?.historyMarker) { const response = await request({ type: 'openTodo', noteId }); setStatus(response.ok ? `Opened note created ${formatAgendaDate(String(props?.originalDue ?? event.start ?? ''))}.` : response.error, !response.ok); return; }
	if (props?.trackedReview) { selectedNoteId = noteId; selectedOccurrenceStart = event.start ? new Date(String(event.start)).toISOString() : null; const response = await request({ type: 'openReview', noteId }); if (!response.ok) setStatus(response.error, true); else if (response.review) renderReview(response.review); }
	else { renderTodoPanel(noteId, String(event.title ?? 'Untitled to-do'), String(props?.memo ?? ''), props?.originalDue); const response = await request({ type: 'openTodo', noteId }); if (!response.ok) setStatus(response.error, true); }
}

async function quickComplete(noteId: string): Promise<void> { if (!noteId) return; const response = await request({ type: 'complete', noteId }); setStatus(response.ok ? 'Completed.' : response.error, !response.ok); }
async function quickSnooze(noteId: string): Promise<void> { if (!noteId) return; const response = await request({ type: 'snooze', noteId, days: 1 }); setStatus(response.ok ? 'Snoozed until tomorrow.' : response.error, !response.ok); }

function startFocusSession(): void {
	const today = localDateKey(new Date());
	focusQueue = allEvents.filter(event => { const props = event.extendedProps as Record<string, any> | undefined; return props?.trackedReview && !props?.historyMarker && String(event.start ?? '').slice(0, 10) <= today; }).sort((a, b) => eventDueValue(a) - eventDueValue(b)).map(event => String((event.extendedProps as Record<string, any>)?.noteId ?? event.id ?? ''));
	document.body.classList.add('focus-mode'); todayDashboard.hidden = true;
	void openNextFocusItem();
}
function advanceFocusSession(): void { if (!document.body.classList.contains('focus-mode')) return; if (selectedNoteId) focusQueue = focusQueue.filter(id => id !== selectedNoteId); void openNextFocusItem(); }
async function openNextFocusItem(): Promise<void> {
	const noteId = focusQueue[0];
	if (!noteId) { document.body.classList.remove('focus-mode'); reviewPanel.hidden = true; focusStartedAt = 0; setStatus('Review session complete.'); return; }
	selectedNoteId = noteId; const response = await request({ type: 'openReview', noteId });
	if (!response.ok) { focusQueue.shift(); return openNextFocusItem(); }
	if (response.review) { renderReview(response.review); setStatus(`Focus session · ${focusQueue.length} topic${focusQueue.length === 1 ? '' : 's'} remaining`); }
	focusStartedAt = Date.now();
}

function renderInsights(): void {
	if (!latestCalendarData) return;
	const { insights } = latestCalendarData;
	const cards = requiredElement('insight-cards');
	const nextWeek = insights.forecast.reduce((sum, item) => sum + item.count, 0);
	cards.replaceChildren(metricCard(String(insights.reviewsThisWeek), 'Reviews this week'), metricCard(`${insights.againRate}%`, 'Again rate'), metricCard(`${insights.minutesStudied}m`, 'Focused study'), metricCard(String(nextWeek), 'Due next 7 days'));
	const difficult = requiredElement('difficult-topics');
	difficult.replaceChildren(...(insights.difficult.length ? insights.difficult.map(item => { const row = document.createElement('div'); row.className = 'agenda-item'; row.textContent = `${item.title} · ${item.count} Again`; return row; }) : [Object.assign(document.createElement('p'), { className: 'helper-text', textContent: 'No difficult topics identified yet.' })]));
	const heatmap = requiredElement('heatmap');
	const days = Array.from({ length: 56 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 55 + index); return localDateKey(date); });
	heatmap.replaceChildren(...days.map(day => { const cell = document.createElement('span'); const count = insights.heatmap[day] ?? 0; cell.className = 'heat-cell'; cell.style.opacity = String(Math.max(.16, Math.min(1, count / 4))); cell.title = `${day}: ${count} review${count === 1 ? '' : 's'}`; return cell; }));
	const calendarSummary = insights.minutesByCalendar.filter(item => item[1] > 0).map(([name, minutes]) => `${name}: ${minutes} min`).join(' · ');
	document.querySelector('.calendar-summary')?.remove();
	if (calendarSummary) { const summary = document.createElement('p'); summary.className = 'helper-text calendar-summary'; summary.textContent = `Study time by calendar · ${calendarSummary}`; heatmap.after(summary); }
}
function metricCard(value: string, label: string): HTMLElement { const card = document.createElement('div'); card.className = 'metric-card'; const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; card.append(strong, span); return card; }

function createRatingButton(rating: Rating, label: string, interval: string): HTMLButtonElement { const button = document.createElement('button'); button.type = 'button'; button.className = `rating rating-${rating}`; button.dataset.rating = String(rating); button.textContent = `${label} (${interval})`; return button; }

function renderEventContent(argument: EventContentArg): { domNodes: Node[] } {
	const wrapper = document.createElement('div'); wrapper.className = 'event-content';
	if (argument.event.extendedProps.historyMarker) wrapper.classList.add('history-marker');
	let touchX = 0;
	wrapper.addEventListener('touchstart', event => { touchX = event.changedTouches[0]?.clientX ?? 0; }, { passive: true });
	wrapper.addEventListener('touchend', event => { if (!mobileMode) return; const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX; const noteId = String(argument.event.extendedProps.noteId ?? argument.event.id); if (delta < -70) void quickComplete(noteId); else if (delta > 70) void quickSnooze(noteId); }, { passive: true });
	const isCompactDateGrid = argument.view.type === 'dayGridMonth' || argument.view.type === 'multiMonthYear';
	if (!argument.event.allDay && !isCompactDateGrid && argument.timeText) {
		const time = document.createElement('span');
		time.className = 'event-time';
		time.textContent = argument.timeText;
		wrapper.append(time);
	}
	const title = document.createElement('strong'); title.textContent = `${argument.event.extendedProps.options?.isTask ? '☐ ' : ''}${argument.event.title}`; wrapper.append(title);
	const memo = String(argument.event.extendedProps.memo ?? '');
	if (memo && !isCompactDateGrid) { const element = document.createElement('span'); element.className = 'event-memo'; element.textContent = memo; wrapper.append(element); }
	const zone = argument.event.extendedProps.options?.secondaryTimeZone as string | undefined;
	if (zone && argument.event.start) { const element = document.createElement('span'); try { element.textContent = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(argument.event.start); wrapper.append(element); } catch { /* Invalid display zones are non-fatal. */ } }
	return { domNodes: [wrapper] };
}

function renderLayers(): void {
	const names = [...new Set(allEvents.map(event => String((event.extendedProps as Record<string, any>)?.options?.calendarName ?? 'Reviews')))].sort();
	layersElement.replaceChildren(...names.map(name => { const label = document.createElement('label'); label.className = 'layer-chip'; const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !hiddenLayers.has(name); box.addEventListener('change', () => { box.checked ? hiddenLayers.delete(name) : hiddenLayers.add(name); applyEventFilters(); }); label.append(box, document.createTextNode(name)); return label; }));
	const list = requiredElement('calendar-name-list'); list.replaceChildren(...names.map(name => { const option = document.createElement('option'); option.value = name; return option; }));
}

function applyEventFilters(): void {
	const query = eventSearch.value.trim().toLocaleLowerCase();
	const agendaView = calendar.view.type === 'listAgenda';
	const filtered = allEvents.filter(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		const layer = String(props?.options?.calendarName ?? 'Reviews');
		if (props?.agendaOnly && !agendaView) return false;
		if (agendaView && props?.historyMarker) return !hiddenLayers.has(layer) && (!query || `${event.title ?? ''} ${props?.memo ?? ''}`.toLocaleLowerCase().includes(query));
		if (agendaView && (props?.undated || props?.status === 'overdue')) return false;
		return !hiddenLayers.has(layer) && (!query || `${event.title ?? ''} ${props?.memo ?? ''} ${props?.options?.location ?? ''}`.toLocaleLowerCase().includes(query));
	});
	calendar.removeAllEvents(); calendar.addEventSource(filtered);
	renderAgendaFooter();
}

function renderAgendaFooter(): void {
	const agendaView = calendar.view.type === 'listAgenda';
	agendaFooter.hidden = !agendaView;
	if (!agendaView) return;
	const query = eventSearch.value.trim().toLocaleLowerCase();
	const visible = allEvents.filter(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		const layer = String(props?.options?.calendarName ?? 'Reviews');
		return !hiddenLayers.has(layer) && (!query || `${event.title ?? ''} ${props?.memo ?? ''}`.toLocaleLowerCase().includes(query));
	});
	const undated = visible.filter(event => Boolean((event.extendedProps as Record<string, any>)?.undated));
	const overdue = visible.filter(event => { const props = event.extendedProps as Record<string, any>; return !props?.historyMarker && props?.status === 'overdue'; })
		.sort((a, b) => eventDueValue(a) - eventDueValue(b));
	renderAgendaSection(agendaUndated, undated);
	renderAgendaSection(agendaOverdue, overdue);
}

function renderAgendaSection(section: HTMLElement, events: EventInput[]): void {
	section.hidden = events.length === 0;
	const container = section.querySelector<HTMLElement>('.agenda-items');
	if (!container) return;
	container.replaceChildren(...events.map(event => {
		const props = event.extendedProps as Record<string, any> | undefined;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'agenda-item';
		const time = document.createElement('time');
		time.textContent = props?.undated ? 'No due date' : formatAgendaDate(String(props?.originalDue ?? event.start ?? ''));
		const title = document.createElement('strong');
		title.textContent = String(event.title ?? 'Untitled to-do');
		button.append(time, title);
		button.addEventListener('click', async () => {
			const noteId = String(props?.noteId ?? event.id ?? '');
			if (props?.trackedReview) {
				selectedNoteId = noteId;
				const response = await request({ type: 'openReview', noteId });
				if (!response.ok) setStatus(response.error, true); else if (response.review) renderReview(response.review);
			} else {
				renderTodoPanel(noteId, String(event.title ?? 'Untitled to-do'), String(props?.memo ?? ''), props?.originalDue);
				const response = await request({ type: 'openTodo', noteId });
				if (!response.ok) setStatus(response.error, true);
			}
		});
		return button;
	}));
}

function eventDueValue(event: EventInput): number {
	const value = (event.extendedProps as Record<string, any>)?.originalDue ?? event.start;
	const time = new Date(String(value ?? '')).getTime();
	return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function formatAgendaDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return 'No due date';
	return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function confirmLocalConflict(start: string, end?: string): boolean {
	if (!end) return true;
	const a = new Date(start).getTime(), b = new Date(end).getTime();
	const conflict = calendar.getEvents().find(event => event.start && event.end && a < event.end.getTime() && b > event.start.getTime());
	return !conflict || window.confirm(`This overlaps “${conflict.title}”. Add it anyway?`);
}

async function refresh(): Promise<void> { setStatus('Refreshing…'); const response = await request({ type: 'refresh' }); if (!response.ok) setStatus(response.error, true); }
async function request(message: unknown): Promise<BackendResponse> {
	try {
		const response = await webviewApi.postMessage(message) as BackendResponse;
		if (response.ok && response.calendar) applyCalendarData(response.calendar);
		return response;
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
function applyCalendarData(message: CalendarDataMessage): void {
	latestCalendarData = message;
	if (message.platform === 'mobile' && !mobileMode) {
		mobileMode = true;
		document.body.classList.add('mobile-mode');
		(requiredElement('export-button') as HTMLButtonElement).hidden = true;
	}
	const savedView = localStorage.getItem(`fsrs-calendar-view-${message.platform}`);
	if (!allEvents.length && savedView) calendar.changeView(savedView);
	else if (!allEvents.length && message.platform === 'mobile') calendar.changeView('listAgenda');
	allEvents = message.events;
	renderLayers();
	applyEventFilters();
	const addHint = mobileMode ? 'Tap a day or time to add' : 'Double-click a day or time to add';
	scopeLabel.textContent = `Notes tagged “${message.tagName}” · ${message.preset} spacing · ${addHint}`;
	setStatus(message.events.length ? `${message.events.length} calendar item${message.events.length === 1 ? '' : 's'}${message.truncated ? ' · reduced-data limit active' : ''}` : `No items yet. ${addHint}.`);
	if (!localStorage.getItem('fsrs-calendar-onboarded')) requiredElement('onboarding').hidden = false;
	resizeCalendarSoon();
	if (!todayDashboard.hidden) renderTodayDashboard();
	if (!insightsPanel.hidden) renderInsights();
}
function setStatus(message: string, isError = false): void { statusElement.textContent = message; statusElement.classList.toggle('is-error', isError); }
function calendarViewportHeight(): number {
	const top = calendarElement.getBoundingClientRect().top;
	const bottomPadding = mobileMode ? 12 : 24;
	return Math.max(mobileMode ? 360 : 420, Math.floor(window.innerHeight - top - bottomPadding));
}
function resizeCalendarSoon(): void {
	window.cancelAnimationFrame(calendarResizeFrame);
	calendarResizeFrame = window.requestAnimationFrame(() => {
		calendar.setOption('height', calendarViewportHeight());
		calendar.updateSize();
	});
}
function setReviewButtonsDisabled(disabled: boolean): void { ratingButtons.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = disabled; }); }
function formatStability(value: number): string { return Number.isFinite(value) ? value < 10 ? `${value.toFixed(1)}d` : `${Math.round(value)}d` : '0d'; }
function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function localTimeValue(date: Date): string { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
function requiredElement(id: string): HTMLElement { const element = document.getElementById(id); if (!element) throw new Error(`Missing required calendar element: ${id}`); return element; }
function input(id: string): HTMLInputElement { return requiredElement(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return requiredElement(id) as HTMLSelectElement; }
