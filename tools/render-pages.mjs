#!/usr/bin/env node
// Renders the signboard into Kindle-sized page images.
//
//   node tools/render-pages.mjs [dist]
//
// KOReader has no HTML engine and cannot follow a CSS animation, so the board
// is photographed here, on the machine that serves it: every slide has a
// standing-still page (/slides/1, /slides/2, ...) which Chromium screenshots at
// each panel size, and the plugin shows those pictures - one per screen, tap to
// move on.
//
// The result goes to dist/kindle/<panel>/page-NN.png, with edition.json telling
// the plugin what to download for the screen it is running on.
//
// Needs Chromium on this machine (the Kindle needs neither).

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.join(DIST, 'kindle');
const NEWS = path.join(ROOT, 'src', 'data', 'news.json');

// The panels this board is printed for, and how many slides are worth
// photographing: feeds.json decides (only the Kindle's pose by default - the
// plugin picks the closest rendering when the device is rotated).
const FEEDS_FILE = path.join(ROOT, 'feeds.json');
const settings = existsSync(FEEDS_FILE) ? JSON.parse(readFileSync(FEEDS_FILE, 'utf8')) : {};
const PROFILES = (settings.profiles || [[600, 800]]).map(([width, height]) => ({ width, height }));
const RENDER_SLIDES = Number(settings.render_slides) || 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// --- what we need ------------------------------------------------------------

function hasBin(name) {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ImageMagick 7 is `magick`; Ubuntu's package is still 6 (`convert` / `identify`).
function findMagick() {
  if (hasBin('magick')) {
    return { identify: ['magick', 'identify'], convert: ['magick'] };
  }
  if (hasBin('identify') && hasBin('convert')) {
    return { identify: ['identify'], convert: ['convert'] };
  }
  throw new Error('ImageMagick not found (tried magick, convert/identify)');
}

function findChromium() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    try {
      execFileSync(fromEnv, ['--version'], { stdio: 'ignore' });
      return fromEnv;
    } catch {
      /* fall through to the usual names */
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      execFileSync(name, ['--version'], { stdio: 'ignore' });
      return name;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('Chromium not found (tried chromium, chromium-browser, google-chrome, chrome)');
}

function slideCount() {
  if (!existsSync(NEWS)) throw new Error(`no ${path.relative(ROOT, NEWS)} - run "npm run news" first`);
  const news = JSON.parse(readFileSync(NEWS, 'utf8'));
  if (news.slides.length > RENDER_SLIDES) {
    console.log(`  ${news.slides.length} stories on the board, rendering the first ${RENDER_SLIDES}`);
  }
  return Math.min(news.slides.length, RENDER_SLIDES);
}

// --- a throwaway server, so the page's absolute /img/... paths resolve --------

function serveDist() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404).end('not found\n');
      return;
    }
    if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
    // Astro builds /slides/1 as slides/1.html; a bare /slides/1 is the same page.
    if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) {
      res.writeHead(404).end('not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// --- one screenshot -----------------------------------------------------------

function screenshot(chromium, url, width, height, shot) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${shot}`,
    ];
    if (process.env.CI) {
      args.unshift('--no-sandbox', '--disable-dev-shm-usage');
    }
    args.push(url);
    const child = spawn(chromium, args);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`chromium exited with ${code}`))));
  });
}

async function renderProfile(chromium, im, port, profile, slides) {
  const { width, height } = profile;
  const dir = path.join(OUT, `${width}x${height}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (let i = 1; i <= slides; i += 1) {
    const shot = path.join(process.env.TMPDIR || '/tmp', `eink-news-${width}x${height}-${i}-${process.pid}.png`);
    const url = `http://127.0.0.1:${port}/slides/${i}.html`;
    await screenshot(chromium, url, width, height, shot);

    const [w, h] = execFileSync(im.identify[0], [...im.identify.slice(1), '-format', '%w %h', shot])
      .toString()
      .trim()
      .split(' ')
      .map(Number);
    if (w !== width || h !== height) {
      throw new Error(`slide ${i} came out ${w}x${h}, expected ${width}x${height}`);
    }

    execFileSync(im.convert[0], [
      ...im.convert.slice(1),
      shot,
      '-colorspace', 'Gray',
      '-depth', '4',
      '-strip',
      path.join(dir, `page-${String(i - 1).padStart(2, '0')}.png`),
    ]);
    rmSync(shot, { force: true });
    process.stdout.write(`\r  ${width}x${height}: slide ${i}/${slides}   `);
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const bytes = files.reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
  process.stdout.write('\n');
  console.log(`  ${width}x${height}: ${files.length} slides, ${(bytes / 1024).toFixed(0)} KB`);
  return { width, height, pages: files };
}

// --- main --------------------------------------------------------------------

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`error: no index.html under ${DIST} - run "npm run build" first`);
  process.exit(1);
}

const slides = slideCount();
const chromium = findChromium();
const im = findMagick();
const { server, port } = await serveDist();

let failed = false;
try {
  const renderings = [];
  for (const profile of PROFILES) {
    renderings.push(await renderProfile(chromium, im, port, profile, slides));
  }
  const edition = {
    generated: new Date().toISOString(),
    seconds: Number(settings.seconds) || 8,
    renderings,
  };
  await writeFile(path.join(OUT, 'edition.json'), JSON.stringify(edition, null, 2) + '\n');
  console.log('  the plugin will read:  <server>/kindle/edition.json');
} catch (err) {
  console.error(`error: ${err.message}`);
  failed = true;
} finally {
  server.close();
}

if (failed) process.exit(1);
