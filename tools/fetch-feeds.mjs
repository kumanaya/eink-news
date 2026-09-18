#!/usr/bin/env node
// Collects the day's stories from every feed in feeds.json and writes
// src/data/news.json, which is what the signboard shows.
//
// The feed list is imported from the World Monitor project
// (github.com/koala73/worldmonitor, AGPL-3.0) by tools/import-worldmonitor-feeds.mjs:
// hundreds of sources, all of them, because a signboard that only shows eight
// stories is not a signboard.
//
// The edition is bounded on purpose, not by accident. feeds.json carries the
// knobs:
//   max_slides        how many stories the board cycles through
//   max_images        used only when require_image is false
//   max_downloads     how many pictures to try before giving up on filling up
//   require_image     true (default): a story without a picture is dropped
//   items_per_feed    how many stories a single feed may contribute
//
// Zero dependencies on purpose: fetch and a few regexes cover RSS 2.0 and Atom.
// The edition (news.json, summaries.json, public/img/news/) is committed, so
// `npm run build` never needs the network: it only reads what is already here.
//
// If every feed fails, the previous edition is kept (and a sample edition is
// written if there is none), so `npm run build` always has something to show.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainText } from './plain-text.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEEDS_FILE = path.join(ROOT, 'feeds.json');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'news.json');
const IMG_DIR = path.join(ROOT, 'public', 'img', 'news');

const FEED_CONCURRENCY = 12;   // be a polite guest on other people's servers
const IMAGE_CONCURRENCY = 4;
const TITLE_CHARS = 90;        // a longer headline would run off the slide
const DESCRIPTION_CHARS = 170; // the blurb under the summary
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // the grayscale copy is what ships
const IMAGE_WIDTH = 640;       // the panel is 600 wide; 640 keeps it crisp
const FETCH_TIMEOUT_MS = 15000;

const BYLINES = [
  'Ada Morrow',
  'James Hale',
  'Elena Voss',
  'Kenji Sato',
  'Amira Hassan',
  'Tomasz Kruk',
  'Claire Brennan',
];
const DATELINES = [
  'LONDON',
  'NEW YORK',
  'TOKYO',
  'BERLIN',
  'PARIS',
  'WASHINGTON',
];

const SAMPLE_EDITION = [
  {
    section: 'World',
    title: 'The signboard holds the day\u2019s stories for the e-ink panel',
    description:
      'Each feed contributes a handful of stories. Pictures are kept locally so the Kindle never makes an external request.',
    link: 'https://www.example.org/',
    byline: 'Ada Morrow',
    dateline: 'LONDON',
    image: null,
    summary: '',
  },
  {
    section: 'Tech',
    title: 'A second story fills the board when the first one has been read',
    description:
      'The page turns on a timer, or on a tap at the left or right third of the screen, the same way a Kindle turns a page.',
    link: 'https://www.example.org/',
    byline: 'James Hale',
    dateline: 'NEW YORK',
    image: null,
    summary: '',
  },
];

// --- small helpers -----------------------------------------------------------

function stripMarkup(s) {
  return plainText(s);
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '') + '\u2026';
}

function firstTag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function attr(tag, name) {
  const m = tag && tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}

function pick(list, seed) {
  return list[seed % list.length];
}

function hash(s) {
  return createHash('sha1').update(s).digest('hex');
}

function isRealSummary(s) {
  const text = plainText(s);
  if (text.length < 40 || /^comments?\b/i.test(text)) return false;
  if (/<[a-z/]/i.test(text)) return false;
  return true;
}

// Runs `fn` over `items` with at most `limit` in flight: hundreds of feeds do
// not fit in a sequential loop, and they should not be hit all at once either.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- feed parsing ------------------------------------------------------------

function parseFeed(xml) {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  return blocks.map(([, body]) => {
    const title = stripMarkup(firstTag(body, 'title'));
    let link = stripMarkup(firstTag(body, 'link'));
    if (!link) {
      const links = body.match(/<link\b[^>]*>/gi) || [];
      const alternate = links.find((l) => !/rel\s*=\s*["'](self|edit)["']/i.test(l));
      link = attr(alternate || links[0] || '', 'href');
    }
    const rawDescription =
      firstTag(body, 'description') || firstTag(body, 'summary') || firstTag(body, 'content');
    const date = stripMarkup(
      firstTag(body, 'pubDate') || firstTag(body, 'published') || firstTag(body, 'updated')
    );
    const image =
      attr((body.match(/<media:content\b[^>]*>/i) || [''])[0], 'url') ||
      attr((body.match(/<media:thumbnail\b[^>]*>/i) || [''])[0], 'url') ||
      imageFromEnclosure(body) ||
      imageFromHtml(rawDescription);
    return { title, link, description: stripMarkup(rawDescription), date, image };
  });
}

function imageFromEnclosure(body) {
  for (const m of body.matchAll(/<enclosure\b[^>]*>/gi)) {
    if (/type\s*=\s*["']image\//i.test(m[0])) return attr(m[0], 'url');
  }
  return '';
}

function imageFromHtml(html) {
  const m = html.match(/<img\b[^>]*>/i);
  return m ? attr(m[0], 'src') : '';
}

// --- images ------------------------------------------------------------------

// ImageMagick 7 ships `magick`; Ubuntu's package is still 6 and ships `convert`.
function magickCommand() {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['-version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      continue;
    }
  }
  return '';
}

function extensionOf(url) {
  const clean = url.split('?')[0];
  const ext = path.extname(clean).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
}

// BBC images come as /ace/standard/240/...: the same picture is served at other
// widths, so ask for one that fills the panel instead of stretching a stamp.
function biggerVariant(url) {
  if (!/ichef\.bbci\.co\.uk/.test(url)) return url;
  return url.replace(/\/(\d{2,4})\//, `/${IMAGE_WIDTH}/`);
}

// The same picture is often shared by several stories (and by several feeds).
// Without this, two downloads of one URL race over the same temporary file,
// and one of them can delete the picture the other just wrote.
const imageDownloads = new Map();

function downloadImage(url, slug, magick) {
  const key = `${url}|${magick ? 'gray' : 'raw'}`;
  if (!imageDownloads.has(key)) {
    imageDownloads.set(key, fetchImage(url, slug, magick));
  }
  return imageDownloads.get(key);
}

async function fetchImage(url, slug, magick) {
  mkdirSync(IMG_DIR, { recursive: true });
  const base = path.join(IMG_DIR, slug);
  const png = `${base}.png`;
  const kept = base + extensionOf(url);

  // A previous edition already fetched this URL: keep the file. Re-converting
  // every picture every run would rewrite the PNGs and turn the committed
  // edition into an 8 MB diff twice an hour.
  if (magick && existsSync(png)) return png;
  if (!magick && existsSync(kept)) return kept;

  try {
    const res = await fetch(biggerVariant(url), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;

    const ext = extensionOf(url);

    if (!magick) {
      await writeFile(kept, buffer);
      return kept;
    }

    // Grayscale and small: the panel has 16 shades and the Wi-Fi is slow.
    // The conversion goes through a temporary name because a source that is
    // already a .png would otherwise be read and written at the same path -
    // and the cleanup below would then delete the picture.
    const tmp = `${base}.src${ext}`;
    await writeFile(tmp, buffer);
    execFileSync(magick, [
      tmp,
      '-resize', `${IMAGE_WIDTH}x>`,
      '-colorspace', 'Gray',
      '-depth', '4',
      '-strip',
      png,
    ]);
    rmSync(tmp, { force: true });
    return png;
  } catch (err) {
    console.warn(`    image failed: ${url} (${err.message})`);
    return null;
  }
}

function pruneImages(used) {
  if (!existsSync(IMG_DIR)) return;
  for (const file of readdirSync(IMG_DIR)) {
    if (!used.has(path.join(IMG_DIR, file))) rmSync(path.join(IMG_DIR, file), { force: true });
  }
}

// --- main --------------------------------------------------------------------

async function main() {
  const config = JSON.parse(await readFile(FEEDS_FILE, 'utf8'));
  const maxSlides = Number(config.max_slides) || 200;
  const maxImages = Number(config.max_images) || 150;
  const perFeed = Number(config.items_per_feed) || 2;
  const magick = magickCommand();

  const jobs = [];
  for (const section of config.sections) {
    for (const feed of section.feeds || []) jobs.push({ section: section.name, feed });
  }
  console.log(`  ${jobs.length} feeds to poll...`);

  const started = Date.now();
  const results = await mapPool(jobs, FEED_CONCURRENCY, async (job) => {
    try {
      const res = await fetch(job.feed.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'eink-news/1.0 (local e-ink reader)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return { job, items: parseFeed(xml).slice(0, perFeed) };
    } catch (err) {
      return { job, items: [], error: err.message };
    }
  });

  const seen = new Set();
  const candidates = [];
  let reachable = 0;
  for (const result of results) {
    if (result.error) continue;
    reachable += 1;
    for (const raw of result.items) {
      if (!raw.title) continue;
      // Feeds overlap: the same story can arrive from several of them.
      const key = raw.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const seed = parseInt(hash(raw.title).slice(0, 8), 16);
      candidates.push({
        section: result.job.section,
        title: truncate(raw.title, TITLE_CHARS),
        // The AI summary is written by tools/summarize.mjs; the feed text
        // stays as the description under it.
        summary: '',
        description: isRealSummary(raw.description)
          ? truncate(plainText(raw.description), DESCRIPTION_CHARS)
          : '',
        link: raw.link,
        date: raw.date || null,
        byline: pick(BYLINES, seed),
        dateline: pick(DATELINES, seed >> 3),
        image: null,
        sourceImage: raw.image,
      });
    }
  }

  // Newest first: a signboard leads with what just happened.
  candidates.sort((a, b) => dateValue(b.date) - dateValue(a.date));
  let slides = candidates;

  let slidesOut;
  if (slides.length === 0) {
    const previous = existsSync(OUT_FILE) ? JSON.parse(await readFile(OUT_FILE, 'utf8')) : null;
    if (previous && previous.slides && previous.slides.length > 0) {
      console.warn('  no feed reachable; keeping the previous edition');
      return;
    }
    console.warn('  no feed reachable and no previous edition; writing a sample edition');
    slidesOut = SAMPLE_EDITION.map((slide) => ({ ...slide }));
  } else {
    slidesOut = slides;
  }

  // Pictures. By default a story without one does not make the board (an empty
  // frame where the photograph should be is worse than one story less), so the
  // candidates are worked through in chunks until enough stories have a picture
  // - or until the download budget runs out.
  const usedImages = new Set();
  const requireImage = config.require_image !== false;
  const downloadBudget = Number(config.max_downloads) || 400;
  let tried = 0;
  let fetched = 0;

  const withPicture = async (chunk) => {
    await mapPool(chunk, IMAGE_CONCURRENCY, async (slide) => {
      tried += 1;
      const file = await downloadImage(slide.sourceImage, hash(slide.sourceImage).slice(0, 12), magick);
      if (file && !existsSync(file)) {
        // a race lost the file: better a story less than a broken frame
        console.warn(`    image vanished: ${slide.sourceImage}`);
        return;
      }
      if (file) {
        usedImages.add(file);
        slide.image = `/img/news/${path.basename(file)}`;
        fetched += 1;
      }
      if (tried % 20 === 0) process.stdout.write(`\r  images: ${fetched} kept / ${tried} tried   `);
    });
  };

  if (!requireImage) {
    // Old behaviour: pictures only for the first stories, the rest keep text.
    const some = slidesOut.slice(0, maxImages).filter((slide) => slide.sourceImage);
    await withPicture(some);
    pruneImages(usedImages);
    for (const slide of slidesOut) delete slide.sourceImage;
  } else {
    const queue = candidates.slice(0, downloadBudget).filter((slide) => slide.sourceImage);
    const kept = [];
    const CHUNK = 60;
    for (let i = 0; i < queue.length && kept.length < maxSlides; i += CHUNK) {
      const chunk = queue.slice(i, i + CHUNK);
      await withPicture(chunk);
      kept.push(...chunk.filter((slide) => slide.image));
    }
    process.stdout.write('\r');
    pruneImages(usedImages);
    if (kept.length === 0) {
      console.warn('  no story came with a picture; keeping text only for this edition');
      for (const slide of slidesOut) delete slide.sourceImage;
    } else {
      slidesOut = kept.slice(0, maxSlides);
      for (const slide of slidesOut) delete slide.sourceImage;
    }
  }

  const edition = {
    masthead: config.masthead,
    tagline: config.tagline,
    edition: config.edition,
    price: config.price,
    seconds: Number(config.seconds) || 8,
    generatedAt: new Date().toISOString(),
    feeds: { polled: jobs.length, reachable },
    slides: slidesOut,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(edition, null, 2) + '\n');

  const withImages = slidesOut.filter((slide) => slide.image).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `  ${slidesOut.length} stories (${withImages} with a picture) from ${reachable}/${jobs.length} feeds in ${seconds}s`
  );
}

function dateValue(date) {
  const parsed = Date.parse(date || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
