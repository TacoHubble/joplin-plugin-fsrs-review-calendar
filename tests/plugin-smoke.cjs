'use strict';

const path = require('node:path');

let registration;
let calendarMessageHandler;
const commands = new Map();
const platform = process.argv[2] === 'mobile' ? 'mobile' : 'desktop';
let panelShown = false;

global.joplin = {
	async versionInfo() { return { version: '3.7.16', profileVersion: 53, syncVersion: 3, platform }; },
	plugins: {
		register(value) { registration = value; },
		async installationDir() { return path.resolve(__dirname, '../dist'); },
	},
	settings: {
		async registerSection() {},
		async registerSettings() {},
		async value(key) {
			if (key === 'intervalPreset') return 'standard';
			if (key === 'dailyCapacityMinutes') return 240;
			if (key === 'reducedDataMode') return false;
			return 'fsrs';
		},
		async onChange() {},
	},
	views: {
		editors: {
			async register(_id, callbacks) { await callbacks.onSetup('test-editor'); },
			async setHtml(_editor, html) {
				if (!/id=(?:["']?calendar["']?)/.test(html)) throw new Error('Calendar HTML was not loaded.');
			},
			async addScript() {},
			async onMessage(_editor, handler) { calendarMessageHandler = handler; },
			async onUpdate() {},
			async isVisible() { return false; },
			async postMessage() {},
		},
		panels: {
			async create() { return 'test-panel'; },
			async setHtml(_panel, html) {
				if (!/id=(?:["']?calendar["']?)/.test(html)) throw new Error('Calendar HTML was not loaded.');
			},
			async addScript() {},
			async onMessage(_panel, handler) { calendarMessageHandler = handler; },
			async show() { panelShown = true; },
			async postMessage() {},
		},
		menuItems: { async create() {} },
		toolbarButtons: { async create() {} },
		dialogs: { async showToast() {} },
	},
	commands: {
		async register(command) { commands.set(command.name, command); },
		async execute() {},
	},
	workspace: {
		async onNoteChange() {},
		async onSyncComplete() {},
	},
	data: {
		async get(resourcePath) {
			if (resourcePath[0] === 'tags') return { items: [], has_more: false };
			if (resourcePath[0] === 'folders') return { items: [{ id: 'calendar-folder', title: 'Calendar' }], has_more: false };
			if (resourcePath[0] === 'notes') return { items: [{ id: 'todo-note', title: 'Ordinary to-do', body: '', is_todo: 1, todo_due: Date.now() + 86400000, todo_completed: 0, created_time: Date.now() }], has_more: false };
			throw new Error(`Unexpected smoke-test data path: ${resourcePath.join('/')}`);
		},
	},
};

require('../dist/index.js');

(async () => {
	if (!registration || typeof registration.onStart !== 'function') throw new Error('Plugin did not register.');
	await registration.onStart();
	if (!commands.has('fsrsReviewCalendar.toggle')) throw new Error('Toggle command was not registered.');
	if (typeof calendarMessageHandler !== 'function') throw new Error('Calendar message handler was not registered.');
	const result = await calendarMessageHandler({ type: 'ready' });
	if (!result || result.ok !== true) throw new Error('Calendar ready handshake failed.');
	if (!result.calendar || result.calendar.type !== 'calendarData' || !Array.isArray(result.calendar.events)) {
		throw new Error('Initial calendar data was not returned with the ready handshake.');
	}
	if (result.calendar.platform !== platform) throw new Error(`Expected ${platform} calendar payload.`);
	if (result.calendar.events.length !== 1 || result.calendar.events[0].extendedProps.agendaOnly !== true) {
		throw new Error('Incomplete untagged Joplin to-do was not added as an Agenda-only event.');
	}
	if (platform === 'mobile') {
		await commands.get('fsrsReviewCalendar.toggle').execute();
		if (!panelShown) throw new Error('Mobile calendar panel did not open.');
	}
	console.log(`Joplin ${platform} bundle smoke test passed.`);
	process.exit(0);
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
