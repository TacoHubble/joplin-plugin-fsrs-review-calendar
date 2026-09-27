# Changelog

All notable user-facing changes are documented here. Versions follow semantic versioning.

## 2.2.0 - 2026-09-27

### Added

- Public-release checks for desktop, Android/mobile, the webview DOM contract, portable paths, and packaged JPL contents.
- Joplin catalog icons and a promotional tile.
- Installation, privacy, security, contribution, and publishing documentation.

### Changed

- Calendar notebook initialization is now non-fatal and retries when an item is created, preventing a transient database or sync condition from stopping Joplin startup.
- The reminder form now advertises only the desktop delivery channel the plugin actually implements.
- Package scripts now offer one reproducible `npm run check` release gate.

## 2.1.1 - 2026-09-27

- Added independent page and calendar scrollers for every view, including Agenda.
- Added immutable note-creation history markers to the calendar.
- Improved timed-event titles, month/year visibility, native to-do integration, and overdue Agenda grouping.

## 2.0.0 - 2026-09-26

- Added the Today dashboard, focus sessions, review history, interval presets, data tools, mobile layouts, recurrence editing, and broader event metadata.

## 1.0.0 - 2026-09-24

- Initial FSRS review calendar with Again/Good review scheduling, tagged-note discovery, native Joplin persistence, and FullCalendar views.
