'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8'));
const archive = path.join(root, 'publish', `${manifest.id}.jpl`);

if (!packageJson.name.startsWith('joplin-plugin-')) throw new Error('Package name must begin with joplin-plugin-.');
if (!packageJson.keywords.includes('joplin-plugin')) throw new Error('Package keywords must include joplin-plugin.');
if (packageJson.version !== manifest.version) throw new Error('package.json and manifest versions differ.');
if (!manifest.platforms?.includes('desktop') || !manifest.platforms?.includes('mobile')) throw new Error('Desktop and mobile support must be declared.');
if (!fs.existsSync(archive)) throw new Error('JPL archive was not created.');
if (fs.readdirSync(path.join(root, 'publish')).some(file => file.includes('archive-placeholder'))) {
	throw new Error('Temporary archive build files leaked into publish/.');
}

const portableFiles = [
	'package.json', 'README.md', 'src/index.ts', 'src/storage.ts',
	'src/fsrsEngine.ts', 'src/webview/index.ts', 'src/webview/index.html',
];
for (const file of portableFiles) {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	if (/C:\\Users\\|\/Users\/|\/home\//i.test(text)) throw new Error(`Machine-specific path found in ${file}.`);
}

(async () => {
	const entries = [];
	await tar.list({ file: archive, onentry: entry => entries.push(entry.path.replace(/^\.\//, '')) });
	for (const required of ['index.js', 'manifest.json', 'webview/index.html', 'webview/index.js', 'webview/style.css', 'images/icon-128.png']) {
		if (!entries.includes(required)) throw new Error(`JPL archive is missing ${required}.`);
	}
	console.log(`Release package smoke test passed (${entries.length} archived files).`);
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
