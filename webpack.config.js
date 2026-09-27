/* eslint-disable no-console */
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const CopyPlugin = require('copy-webpack-plugin');
const tar = require('tar');
const { globSync } = require('glob');

const rootDir = __dirname;
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const publishDir = path.join(rootDir, 'publish');
const manifestPath = path.join(srcDir, 'manifest.json');

function manifest() {
	const value = fs.readJsonSync(manifestPath);
	if (!value.id || !value.name || !value.version || !value.app_min_version) {
		throw new Error('src/manifest.json is missing a required Joplin manifest field.');
	}
	return value;
}

const typescriptRule = {
	test: /\.tsx?$/,
	use: 'ts-loader',
	exclude: /node_modules/,
};

const mainConfig = {
	name: 'plugin',
	mode: 'production',
	target: 'node',
	entry: './src/index.ts',
	devtool: 'source-map',
	module: { rules: [typescriptRule, { test: /\.html$/, type: 'asset/source' }] },
	resolve: {
		alias: { api: path.resolve(rootDir, 'api') },
		extensions: ['.ts', '.tsx', '.js', '.json'],
	},
	node: { __dirname: false, __filename: false },
	output: { filename: 'index.js', path: distDir, clean: true },
	plugins: [
		new CopyPlugin({
			patterns: [{
				from: '**/*',
				context: srcDir,
				to: distDir,
				globOptions: { ignore: ['**/*.ts', '**/*.tsx'] },
			}],
		}),
	],
	stats: 'errors-warnings',
};

const webviewConfig = {
	name: 'webview',
	mode: 'production',
	target: 'web',
	entry: './src/webview/index.ts',
	devtool: 'source-map',
	module: { rules: [typescriptRule] },
	resolve: { extensions: ['.ts', '.tsx', '.js', '.json'] },
	output: { filename: 'index.js', path: path.join(distDir, 'webview') },
	// FullCalendar's six view plugins, RFC 5545 recurrence, and Chrono NLP are
	// intentionally shipped in one offline-capable webview bundle.
	performance: { maxAssetSize: 700_000, maxEntrypointSize: 700_000 },
	stats: 'errors-warnings',
};

function archiveConfig() {
	return {
		name: 'archive',
		mode: 'production',
		target: 'node',
		entry: path.join(distDir, 'index.js'),
		output: { filename: '.archive-placeholder.js', path: publishDir },
		plugins: [{
			apply(compiler) {
				compiler.hooks.done.tap('CreateJoplinArchive', () => {
					const metadata = manifest();
					fs.ensureDirSync(publishDir);
					fs.removeSync(path.join(publishDir, '.archive-placeholder.js'));
					fs.removeSync(path.join(publishDir, '.archive-placeholder.js.LICENSE.txt'));
					const files = globSync(`${distDir}/**/*`, { nodir: true, windowsPathsNoEscape: true })
						.map(file => path.relative(distDir, file).replace(/\\/g, '/'));
					if (!files.length) throw new Error('Cannot package an empty dist directory.');
					const archivePath = path.join(publishDir, `${metadata.id}.jpl`);
					fs.removeSync(archivePath);
					tar.create({ file: archivePath, cwd: distDir, portable: true, sync: true }, files);
					const hash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
					fs.writeJsonSync(path.join(publishDir, `${metadata.id}.json`), {
						...metadata,
						_publish_hash: `sha256:${hash}`,
					}, { spaces: '\t' });
					console.log(`Created ${archivePath}`);
				});
			},
		}],
		stats: 'errors-only',
	};
}

function updateVersion() {
	const packageJsonPath = path.join(rootDir, 'package.json');
	const packageJson = fs.readJsonSync(packageJsonPath);
	const pluginManifest = manifest();
	const parts = String(packageJson.version).split('.').map(Number);
	parts[parts.length - 1] += 1;
	const version = parts.join('.');
	packageJson.version = version;
	pluginManifest.version = version;
	fs.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });
	fs.writeJsonSync(manifestPath, pluginManifest, { spaces: '\t' });
	console.log(version);
}

module.exports = env => {
	const task = env && env['joplin-plugin-config'];
	if (task === 'buildMain') return mainConfig;
	if (task === 'buildWebview') return webviewConfig;
	if (task === 'createArchive') return archiveConfig();
	if (task === 'updateVersion') {
		updateVersion();
		return [];
	}
	throw new Error(`Unknown or missing joplin-plugin-config value: ${String(task)}`);
};
