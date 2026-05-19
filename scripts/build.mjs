import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

const paths = {
	packageJson: path.join(root, 'package.json'),
	messagesJson: path.join(root, 'src', 'i18n', 'messages.json'),
	srcScript: path.join(root, 'src', 'booth-batch.user.js'),
	chromeManifestTemplate: path.join(root, 'src', 'chrome', 'manifest.json'),
	publicDir: path.join(root, 'public'),
	distDir: path.join(root, 'dist'),
	userscriptDir: path.join(root, 'dist'),
	chromeExtensionDir: path.join(root, 'dist', 'chrome-extension'),
};

const contentScriptFileName = 'booth-batch.content.js';
const locales = ['ko', 'en', 'ja'];
const defaultUserscriptLocale = 'ko';

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSourceScript({ buildDate, messages, locale }) {
	return fs
		.readFileSync(paths.srcScript, 'utf8')
		.replaceAll('__BUILD_DATE__', buildDate)
		.replace('/* __BPTE_MESSAGES__ */ {}', JSON.stringify(messages, null, '\t'))
		.replaceAll('__BPTE_BUILD_LOCALE__', locale);
}

function stripUserscriptMetadata(code) {
	return code.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\r?\n?/, '');
}

function createUserscriptMetadata({ packageJson, messages, downloadURL, updateURL }) {
	const defaultMessage = messages[defaultUserscriptLocale];
	return [
		'// ==UserScript==',
		`// @name         ${defaultMessage.extensionName}`,
		...locales.map((locale) => `// @name:${locale}      ${messages[locale].extensionName}`),
		'// @namespace    https://studio.iyan-kim.dev/',
		`// @version      ${packageJson.version}`,
		`// @description  ${defaultMessage.extensionDescription}`,
		...locales.map((locale) => `// @description:${locale} ${messages[locale].extensionDescription}`),
		'// @match        https://manage.booth.pm/items/*/edit',
		'// @run-at       document-idle',
		'// @grant        none',
		`// @downloadURL  ${downloadURL}`,
		`// @updateURL    ${updateURL}`,
		'// ==/UserScript==',
		'',
	].join('\n');
}

function withUserscriptMetadata(source, options) {
	return `${createUserscriptMetadata(options)}${stripUserscriptMetadata(source)}`;
}

function toChromeVersion(version) {
	const parts = String(version).match(/\d+/g)?.map(Number).slice(0, 4) ?? [];
	while (parts.length < 3) parts.push(0);

	for (const part of parts) {
		if (!Number.isInteger(part) || part < 0 || part > 65535) {
			throw new Error(`Invalid Chrome extension version part: ${part}`);
		}
	}

	return parts.join('.');
}

function copyPublicToDist() {
	if (!fs.existsSync(paths.publicDir)) return;
	fs.cpSync(paths.publicDir, paths.distDir, { recursive: true });
}

function writeUserscript({ source, packageJson, messages, outputDir, publicPath }) {
	const url = `https://studio-iyan-booth-batch.pages.dev/${publicPath}`;
	const output = withUserscriptMetadata(source, {
		packageJson,
		messages,
		downloadURL: url,
		updateURL: url,
	});

	fs.mkdirSync(outputDir, { recursive: true });
	fs.writeFileSync(path.join(outputDir, 'booth-batch.user.js'), output, 'utf8');
	console.log(`Built userscript to ${path.relative(root, outputDir)}\\booth-batch.user.js`);
}

function buildUserscripts({ packageJson, messages, buildDate }) {
	const source = readSourceScript({ buildDate, messages, locale: 'auto' });
	const targets = [
		{
			outputDir: paths.userscriptDir,
			publicPath: 'booth-batch.user.js',
		},
		{
			outputDir: path.join(paths.userscriptDir, 'beta'),
			publicPath: 'booth-batch.user.js',
		},
	];

	for (const target of targets) {
		writeUserscript({
			source,
			packageJson,
			messages,
			...target,
		});
	}
}

function writeChromeLocales(messages) {
	for (const locale of locales) {
		const message = messages[locale];
		const localeDir = path.join(paths.chromeExtensionDir, '_locales', locale);
		const chromeMessages = {
			extensionName: { message: message.extensionName },
			extensionShortName: { message: message.extensionShortName },
			extensionDescription: { message: message.extensionDescription },
			actionTitle: { message: message.actionTitle },
		};

		fs.mkdirSync(localeDir, { recursive: true });
		fs.writeFileSync(path.join(localeDir, 'messages.json'), `${JSON.stringify(chromeMessages, null, '\t')}\n`, 'utf8');
	}
}

function buildChromeExtension({ source, packageJson, messages }) {
	fs.mkdirSync(paths.chromeExtensionDir, { recursive: true });

	const chromeVersion = toChromeVersion(packageJson.version);
	const manifestText = fs
		.readFileSync(paths.chromeManifestTemplate, 'utf8')
		.replaceAll('__CHROME_VERSION__', chromeVersion)
		.replaceAll('__PACKAGE_VERSION__', packageJson.version);
	const manifest = JSON.parse(manifestText);

	fs.writeFileSync(
		path.join(paths.chromeExtensionDir, 'manifest.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`,
		'utf8',
	);
	fs.writeFileSync(
		path.join(paths.chromeExtensionDir, contentScriptFileName),
		stripUserscriptMetadata(source),
		'utf8',
	);
	writeChromeLocales(messages);

	console.log(`Built Chrome extension to dist/chrome-extension (version ${chromeVersion})`);
}

function parseTargets(args) {
	const explicitTargets = args.filter((arg) => !arg.startsWith('-'));
	const targets = explicitTargets.length > 0 ? explicitTargets : ['all'];
	const normalized = new Set(targets.map((target) => target.toLowerCase()));

	return {
		userscript: normalized.has('all') || normalized.has('userscript'),
		extension: normalized.has('all') || normalized.has('extension') || normalized.has('chrome'),
	};
}

export function build({ args = process.argv.slice(2) } = {}) {
	const packageJson = readJson(paths.packageJson);
	const messages = readJson(paths.messagesJson);
	const buildDate = new Date().toISOString();
	const targets = parseTargets(args);

	if (!targets.userscript && !targets.extension) {
		throw new Error(`Unknown build target: ${args.join(' ')}`);
	}

	fs.rmSync(paths.distDir, { recursive: true, force: true });
	fs.mkdirSync(paths.distDir, { recursive: true });

	if (targets.userscript) {
		copyPublicToDist();
		buildUserscripts({ packageJson, messages, buildDate });
	}

	if (targets.extension) {
		const source = readSourceScript({ buildDate, messages, locale: 'auto' });
		buildChromeExtension({ source, packageJson, messages });
	}
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryFile === currentFile) {
	build();
}
