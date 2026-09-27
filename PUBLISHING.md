# Publishing checklist

The public source repository is `TacoHubble/joplin-plugin-fsrs-review-calendar`. Keep ownership fields synchronized if stewardship changes.

## One-time setup

1. Keep GitHub private security advisories enabled.
2. Verify that the npm package name `joplin-plugin-fsrs-review-calendar` is available and configure npm two-factor authentication.
3. Add the repository to the official Joplin plugin publishing workflow after the first npm release.

## Every release

1. Update `CHANGELOG.md` and keep the versions in `package.json` and `src/manifest.json` identical.
2. Run `npm ci`, `npm audit`, and `npm run check` from a clean clone.
3. Install `publish/com.fsrs.review-calendar.jpl` in fresh desktop and Android test profiles.
4. Verify upgrade behavior with a copy of data from the previous release.
5. Commit the source, create a signed version tag, and attach the `.jpl` and generated metadata JSON to the GitHub release.
6. Run `npm publish` from the maintainer account.
7. Follow the current submission instructions in the official `joplin/plugins` repository and verify the listing after its scheduled update.

The immutable plugin ID is `com.fsrs.review-calendar`. Do not change it after public release or Joplin will treat the package as a different plugin.
