# Security and data safety

## Supported version

Security and data-loss fixes are provided for the latest published release.

## Reporting a vulnerability

Use the repository's [private security-advisory form](https://github.com/TacoHubble/joplin-plugin-fsrs-review-calendar/security/advisories/new) rather than a public issue when disclosure could expose user data or enable code execution.

Include the plugin version, Joplin version, platform, reproducible steps, impact, and any relevant log excerpt with personal note content removed.

## Data model

The plugin stores events as ordinary Joplin notes/to-dos and stores scheduling metadata with Joplin user data. It does not operate a server and does not transmit note content itself. Joplin synchronization, encryption, backups, and account security remain governed by the user's Joplin configuration.

Imported ICS and JSON backup text is treated as data, not executable code. Event titles, bodies, URLs, attendees, and recurrence values must remain escaped or validated before display or persistence.
