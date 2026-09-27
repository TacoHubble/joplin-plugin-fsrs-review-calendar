# Contributing

Thank you for helping improve FSRS Review Calendar.

## Development setup

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Run `npm run check` before submitting a change.
4. Add this directory in Joplin under **Plugins → Advanced Settings → Development plugins** and restart Joplin for interactive testing.

Keep calendar data local-first, preserve backward compatibility with existing `fsrs_state` and `fsrs_calendar` user data, and make startup failure-safe. New network integrations must be opt-in, document exactly what leaves Joplin, and keep the core calendar functional offline.

For UI changes, test at minimum:

- Desktop Day, Week, Month, Year, Agenda, and Today views.
- Android/mobile Agenda and Today views.
- Keyboard and touch operation, narrow widths, scrolling, dark/light themes, and reduced-motion settings.
- Existing tagged notes, ordinary to-dos, completed to-dos, recurrence exceptions, and a temporarily unavailable sync/data layer.

Do not commit a personal Joplin profile, exported user data, credentials, calendar contents, or generated `node_modules`/`dist` directories.
