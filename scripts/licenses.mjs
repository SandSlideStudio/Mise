/**
 * Writes THIRD-PARTY-NOTICES.md: every package that ships with Mise, with its
 * version, its licence and the licence text it comes with.
 *
 *   node scripts/licenses.mjs           write the file
 *   node scripts/licenses.mjs --check   fail if the file is out of date
 *
 * What ships is read from package-lock.json rather than from whatever happens
 * to be in node_modules: the lockfile marks everything that is only needed to
 * build or test as `dev`, and it lists the native builds for every platform,
 * not only the one this machine installed. So the file comes out the same on
 * a laptop, in CI and in the Docker build. The licence texts themselves come
 * from node_modules, so run `npm ci` first.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');

const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

/**
 * Not in the dependency tree, but in what a browser downloads: the build tools
 * copy a little of their own code into the client bundle.
 */
const BUNDLED_BY_THE_BUILD = [
  { key: 'node_modules/tailwindcss', why: 'its base styles are part of the stylesheet' },
  { key: 'node_modules/vite', why: 'its module preload helper is part of the scripts' },
];

/** The fonts, named once more in their own words, because they are the most visible. */
const FONTS = [
  'Barlow and Barlow Condensed (the typefaces of the whole app, its prints and its PDFs):',
  'Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow).',
  'Licensed under the SIL Open Font License, Version 1.1. The full text is under',
  '@fontsource/barlow below.',
];

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The licence file(s) a package ships, joined, or null when it ships none. */
function licenceText(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name))
    .sort();
  if (files.length === 0) return null;
  return files
    .map((name) => readFileSync(path.join(dir, name), 'utf8').replace(/\r\n?/g, '\n').trim())
    .join('\n\n');
}

/** For a package with no licence file: its copyright line, from its readme or its author. */
function copyrightLine(dir, info) {
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!/^readme/i.test(name)) continue;
    const line = readFileSync(path.join(dir, name), 'utf8')
      .split('\n')
      .find((text) => /copyright\s+(\(c\)|©|\d{4})/i.test(text));
    if (line) return line.trim();
  }
  const author = typeof info.author === 'string' ? info.author : info.author?.name;
  return author ? `Author: ${author}` : null;
}

function packageName(key) {
  return key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

function licenceOf(entry, info) {
  const licence = entry.license ?? info?.license;
  if (typeof licence === 'string') return licence;
  if (licence?.type) return licence.type;
  return 'not stated';
}

/** The package that lists this one as an optional dependency. */
function ownerOf(name) {
  const owner = Object.entries(lock.packages).find(
    ([, entry]) => entry.optionalDependencies && name in entry.optionalDependencies,
  );
  return owner ? packageName(owner[0]) : 'the package it belongs to';
}

const entries = Object.entries(lock.packages)
  .filter(([key, entry]) => key.includes('node_modules/') && !entry.dev && !entry.link)
  .map(([key, entry]) => ({ key, entry, why: null }));
for (const extra of BUNDLED_BY_THE_BUILD) {
  const entry = lock.packages[extra.key];
  if (!entry) throw new Error(`${extra.key} is not in package-lock.json`);
  entries.push({ key: extra.key, entry, why: extra.why });
}

const missing = [];
const blocks = entries
  .map(({ key, entry, why }) => {
    const name = packageName(key);
    const dir = path.join(ROOT, key);
    const info = existsSync(path.join(dir, 'package.json'))
      ? readJson(path.join(dir, 'package.json'))
      : null;
    // A native build for one platform: only one of them is ever installed, and
    // they carry the licence of the package they belong to.
    const platform = Boolean(entry.os || entry.cpu);
    if (!info && !platform) missing.push(name);
    const licence = licenceOf(entry, info);
    const lines = [`## ${name} ${entry.version}`, '', `Licence: ${licence}`];
    if (why) lines.push('', `Bundled into the client by the build: ${why}.`);
    const parent = platform ? ownerOf(name) : null;
    const text = platform ? null : licenceText(dir);
    if (platform) {
      lines.push('', `A native build for one platform; the licence text is as for ${parent}.`);
    } else if (text) {
      lines.push('', '```text', text.replaceAll('```', "'''"), '```');
    } else {
      const line = info ? copyrightLine(dir, info) : null;
      lines.push('', line ?? 'The package ships no licence file.');
    }
    return { name, version: entry.version, text: lines.join('\n') };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));

if (missing.length > 0) {
  console.error(`Not installed, run npm ci first: ${missing.join(', ')}`);
  process.exit(1);
}

const output = `${[
  '# Third-party notices',
  '',
  'Mise is free software under the GNU Affero General Public License, version 3',
  '(see LICENSE). It is built on the work of others, listed here with their',
  'licences: everything that ships in the server and in the app a browser loads.',
  '',
  'This file is written by `node scripts/licenses.mjs`; do not edit it by hand.',
  '',
  '## Fonts',
  '',
  ...FONTS,
  '',
  ...blocks
    .map((block) => block.text)
    .join('\n\n')
    .split('\n'),
].join('\n')}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== output) {
    console.error('THIRD-PARTY-NOTICES.md is out of date: run node scripts/licenses.mjs');
    process.exit(1);
  }
  console.log(`THIRD-PARTY-NOTICES.md is up to date (${blocks.length} packages).`);
} else {
  writeFileSync(OUT, output);
  console.log(`Wrote THIRD-PARTY-NOTICES.md (${blocks.length} packages).`);
}
