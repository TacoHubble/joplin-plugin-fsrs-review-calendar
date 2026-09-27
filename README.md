# FSRS Review Calendar for Joplin

[![Release checks](https://github.com/TacoHubble/joplin-plugin-fsrs-review-calendar/actions/workflows/release-check.yml/badge.svg)](https://github.com/TacoHubble/joplin-plugin-fsrs-review-calendar/actions/workflows/release-check.yml)

An interactive cross-platform calendar that turns tagged Joplin notes into scheduled topic reviews. Desktop uses the full editor area; mobile uses a touch-friendly full-screen plugin panel that defaults to Agenda. A calendar item records that the user studied a topic; the official [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) implementation then chooses when that topic should return.

Calendar entries are ordinary Joplin to-dos, so they remain available offline and sync through Joplin across devices. The plugin does not require an account or send calendar data to a separate service.

## Install

Until this package is accepted into Joplin's public catalog, install the release file manually from the [latest GitHub release](https://github.com/TacoHubble/joplin-plugin-fsrs-review-calendar/releases/latest):

1. Download `com.fsrs.review-calendar.jpl` from the release's assets.
2. On desktop, open **Tools → Options → Plugins**, choose the gear menu, select **Install from file**, and restart Joplin when prompted.
3. On Android, open **Configuration → Plugins**, use the install-from-file action, and select the same `.jpl` file.

Joplin for iOS can install only plugins included in Joplin's recommended plugin set. The notes and to-dos created by the plugin still sync to iOS and remain editable there even before the calendar UI is catalog-approved.

## Features

- A unified **Today** dashboard separates due reviews, scheduled work, overdue items, and unscheduled to-dos, with daily-capacity warnings and a guided focus session.
- Quick **Snooze**, **Skip today**, **Undo**, **Complete**, and **Stop repeating** controls keep scheduling decisions explicit.
- Four topic-scale FSRS presets—Relaxed, Standard, Intensive, and Exam preparation—are configurable in plugin settings.
- Review history records Again/Good decisions, scheduling changes, and focused study minutes. Insights add a seven-day forecast, difficult-topic list, consistency heat map, and time by calendar.
- Edit every event field after creation. RFC 5545 series can be edited as a whole or detached one occurrence at a time.
- Repair metadata and export/import duplicate-safe JSON backups from **Data tools**.
- First-run guidance, a removable sample topic, remembered desktop/mobile views, reduced-data mode, and mobile swipe actions.
- Every calendar view uses a viewport-aware vertical scroller with sticky headers, including the full 24-hour Day, 3-Day, and Week grids.
- Each tracked note also gets an immutable purple **Created** marker on its original Joplin creation date. These markers form a browsable study-history layer without entering Today queues or changing the next FSRS review.
- Agenda uses coordinated inner and page scrolling so upcoming events can hand off naturally to the Unscheduled and Overdue sections below them.
- Tracks notes tagged `fsrs` (configurable under **Tools → Options → FSRS Review Calendar**).
- Creates or reuses a root **Calendar** notebook. New calendar memos are saved there as native Joplin to-dos with synchronized due times.
- Completed to-dos disappear from the active calendar automatically; unchecking one in Joplin restores it. The review bar also provides a one-click **Mark complete** action.
- Agenda automatically includes every incomplete Joplin to-do, even when it is outside the Calendar notebook and does not carry the FSRS tag. Untagged to-dos remain Agenda-only, undated tasks receive their own section, and overdue work is grouped at the bottom.
- Initializes new cards automatically and stores state in synchronized Joplin user data under `fsrs_state`.
- Falls back to a final `<!-- fsrs-state: {...} -->` note-body comment when user data is unavailable.
- Toggle between the normal note editor and a spacious calendar editor from the toolbar or Tools menu.
- Day, 3-day, week, month, year, and agenda/list views with overdue, due-today, and upcoming colors.
- Month and year cells always show each event title (collapsing to FullCalendar's “+N more” control only when needed); Day, 3-day, and Week views show exact occupied time blocks with time ranges and memo titles, plus a dedicated all-day row.
- Double-click any day or hourly slot to create a titled memo as a real tagged Joplin note.
- Choose all-day or timed placement, then drag events or their lower edge to change start times and durations.
- Turn **Repeat with FSRS** on or off per item, either at creation time or from the review bar.
- Keep FSRS adaptive repetition separate from fixed RFC 5545 recurrence (daily, weekdays, weekly, first Monday, or a custom RRULE).
- Add events in natural language, search instantly, toggle color-coded calendar layers, and use `T`, `D`, `W`, `M`, `Y`, `A`, and `/` keyboard shortcuts.
- Store an event time zone plus an optional second display time zone, location, meeting URL, attendees/RSVP state, visibility, and task/time-block status.
- Configure local Joplin desktop reminders and custom offsets. Reminders fire while Joplin is open; unsupported push/email delivery is not advertised.
- Import pasted `.ics` VEVENT data and copy the complete tracked calendar as `.ics` for external calendar apps.
- Timed Week and Day events show both their title and memo preview.
- Drag-and-drop due-date changes that preserve FSRS stability and difficulty.
- A focused **Again / Good** review choice with live interval previews. Topic-scale learning steps begin at roughly 2 days for Again and 7 days for Good, then successful reviews expand toward several weeks under FSRS.
- Refreshes after note changes, sync completion, settings changes, manual refreshes, ratings, and drag operations.

## Build

Node.js 20.9 or newer is required by the current build dependencies and `ts-fsrs`.

```bash
npm install
npm run check
```

The installable plugin is written to `publish/com.fsrs.review-calendar.jpl`. `npm run check` type-checks both bundles, creates the archive, runs desktop/mobile startup smoke tests, verifies the webview DOM contract, and inspects the final archive. For development, add this project directory under Joplin's **Plugins → Advanced Settings → Development plugins**, then restart Joplin.

## Use

1. Add the `fsrs` tag to any note you want to review.
2. Choose **Tools → Toggle FSRS Review Calendar** or use the calendar button in the note toolbar to replace the note editor with the full calendar.
3. Click an event to open its topic note and show the review controls.
4. Choose **Again** when the topic needs another near-term pass or **Good** when the study session was successful. Toggle again to return to the normal note editor.

To create an item, double-click a day in Month view or an hourly slot in Week/Day view. Enter the topic studied and an optional memo, choose all-day or timed placement, and decide whether it should reappear through FSRS. One-off items stay at their chosen date; adaptive topic reviews expose only Again and Good. The initial previews are deliberately measured in days instead of Anki-style minutes, and successful reviews expand into week-scale intervals.

The manual drag operation changes only `due`; it intentionally leaves stability, difficulty, repetitions, lapses, and review history untouched.

Calendar notes and their metadata are local-first and participate in Joplin's own synchronization, caching, encryption, and offline editing. Authenticated CalDAV servers, external invitation delivery, hosted access-control enforcement, push/email gateways, provider-created Zoom/Meet/Teams rooms, maps, and live travel-time services are not implemented. The plugin never silently transmits calendar content to a third party.

The calendar displays only the next FSRS review for each topic. Past study sessions remain represented by the note's FSRS history rather than being duplicated as calendar events.

## Data format

The primary `fsrs_state` value is JSON-safe and contains ISO strings for `due` and `last_review`. Existing valid body-comment metadata is read and opportunistically migrated to Joplin user data.

Uninstalling the plugin does not delete notes, to-dos, the Calendar notebook, or synchronized metadata. Use **Data tools → Export backup** before large migrations, and keep Joplin's own note-history and backup features enabled.

## Privacy and permissions

- Reads notes, tags, folders, and to-dos to build the calendar.
- Writes only when initializing FSRS state or when the user creates, edits, reviews, moves, completes, imports, or repairs a calendar item.
- Uses no analytics, advertising, remote API, embedded tracker, or plugin-owned cloud account.
- Network synchronization remains entirely under Joplin's configured sync target and end-to-end-encryption settings.

See [SECURITY.md](SECURITY.md) for reporting and data-safety guidance and [CONTRIBUTING.md](CONTRIBUTING.md) for development checks.

## License

MIT

