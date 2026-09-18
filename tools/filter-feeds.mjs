#!/usr/bin/env node
// Keeps only the feeds that carry a picture.
//
//   node tools/filter-feeds.mjs [--dry]
//
// The board is a picture board: a story without an image leaves an empty box
// where the photograph should be. Instead of downloading from three hundred
// feeds to throw half the stories away, this probes each feed once, keeps the
// ones whose first items come with an image, and moves the rest to
// feeds.no-images.json - nothing is lost, and re-running the World Monitor
// importer brings everyone back if you want to try again.
//
// Run it after importing the feed list, and whenever the list itself changes.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEEDS_FILE = path.join(ROOT, 'feeds.json');
const DROPPED_FILE = path.join(ROOT, 'feeds.no-images.json');

const CONCURRENCY = 12;
const TIMEOUT_MS = 15000;
const SAMPLE_ITEMS = 5; // how many items to look at before judging a feed
const DRY = process.argv.includes('--dry');

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}

function itemsWithImage(xml) {
  const items = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].slice(0, SAMPLE_ITEMS);

  let withImage = 0;
  for (const [, body] of items) {
    const has =
      /<media:content\b[^>]*url\s*=/i.test(body) ||
      /<media:thumbnail\b[^>]*url\s*=/i.test(body) ||
      /<enclosure\b[^>]*type\s*=\s*["']image\//i.test(body) ||
      /<img\b/i.test(body);
    if (has) withImage += 1;
  }
  return { items: items.length, withImage };
}

async function main() {
  const config = JSON.parse(await readFile(FEEDS_FILE, 'utf8'));
  const jobs = [];
  for (const section of config.sections) {
    for (const feed of section.feeds || []) jobs.push({ section, feed });
  }
  console.log(`  probing ${jobs.length} feeds (first ${SAMPLE_ITEMS} items each)...`);

  let done = 0;
  const results = await mapPool(jobs, CONCURRENCY, async (job) => {
    try {
      const res = await fetch(job.feed.url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'eink-news/1.0 (local e-ink reader)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const { items, withImage } = itemsWithImage(xml);
      done += 1;
      if (done % 25 === 0) process.stdout.write(`\r  probed ${done}/${jobs.length}   `);
      return { job, items, withImage, error: null };
    } catch (err) {
      done += 1;
      return { job, items: 0, withImage: 0, error: err.message };
    }
  });
  process.stdout.write('\r');

  const keep = new Set();
  const dropped = new Map(); // section name -> feeds
  let silent = 0;
  for (const result of results) {
    const usable = !result.error && result.withImage > 0;
    if (usable) {
      keep.add(result.job.feed.url);
    } else {
      if (!result.error && result.withImage === 0) silent += 1;
      const list = dropped.get(result.job.section.name) || [];
      list.push(result.job.feed);
      dropped.set(result.job.section.name, list);
    }
  }

  const sections = config.sections
    .map((section) => ({
      ...section,
      feeds: (section.feeds || []).filter((feed) => keep.has(feed.url)),
    }))
    .filter((section) => section.feeds.length > 0);

  const keptFeeds = sections.reduce((n, section) => n + section.feeds.length, 0);
  console.log(`  ${keptFeeds} feeds carry pictures, ${jobs.length - keptFeeds} dropped (${silent} of them simply have none)`);
  for (const section of sections) {
    console.log(`    ${String(section.feeds.length).padStart(3)}  ${section.name}`);
  }

  if (DRY) {
    console.log('  --dry: feeds.json untouched');
    return;
  }

  config.sections = sections;
  config.filteredAt = new Date().toISOString();
  await writeFile(FEEDS_FILE, JSON.stringify(config, null, 2) + '\n');
  await writeFile(
    DROPPED_FILE,
    JSON.stringify(
      { note: 'Feeds that carried no picture when tools/filter-feeds.mjs probed them.', sections: [...dropped.entries()].map(([name, feeds]) => ({ name, feeds })) },
      null,
      2
    ) + '\n'
  );
  console.log('  feeds.json rewritten; the rest is in feeds.no-images.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
