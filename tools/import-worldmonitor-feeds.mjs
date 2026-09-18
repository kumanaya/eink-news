#!/usr/bin/env node
// Writes the sections of feeds.json from the World Monitor feed list.
//
//   node tools/import-worldmonitor-feeds.mjs [local-copy.ts]
//
// World Monitor (github.com/koala73/worldmonitor, AGPL-3.0) curates which news
// sources are worth watching and publishes them in
// server/worldmonitor/news/v1/_feeds.ts. This script turns that file into our
// sections: every feed of every variant, de-duplicated, grouped by the category
// the project files it under. The settings around the sections (masthead,
// seconds, caps) are kept as they are.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEEDS_FILE = path.join(ROOT, 'feeds.json');
const UPSTREAM =
  'https://raw.githubusercontent.com/koala73/worldmonitor/main/server/worldmonitor/news/v1/_feeds.ts';

// The category names in their file are short keys; these are the labels on the
// board.
const LABELS = {
  politics: 'Politics',
  us: 'United States',
  europe: 'Europe',
  middleeast: 'Middle East',
  asia: 'Asia',
  africa: 'Africa',
  latam: 'Latin America',
  tech: 'Tech',
  ai: 'AI',
  finance: 'Finance',
  commodities: 'Commodities',
  energy: 'Energy',
  gov: 'Government',
  crisis: 'Crisis',
  thinktanks: 'Think Tanks',
  layoffs: 'Layoffs',
  security: 'Security',
  policy: 'Policy',
  startups: 'Startups',
  vcblogs: 'VC Blogs',
  unicorns: 'Unicorns',
  accelerators: 'Accelerators',
  github: 'GitHub',
  funding: 'Funding',
  cloud: 'Cloud',
  happiness: 'Good News',
  sport: 'Sport',
};

async function main() {
  const local = process.argv[2];
  const source = local
    ? await readFile(local, 'utf8')
    : await (await fetch(UPSTREAM, { signal: AbortSignal.timeout(30000) })).text();

  const sections = new Map(); // category -> Map(url -> name)
  let category = null;
  for (const line of source.split('\n')) {
    const categoryMatch = line.match(/^ {4}([a-z]+): \[/);
    if (categoryMatch) {
      category = categoryMatch[1];
      continue;
    }
    const entry = line.match(/\{ name: '([^']+)', url: '([^']+)'/);
    if (entry && category) {
      if (!sections.has(category)) sections.set(category, new Map());
      const feeds = sections.get(category);
      if (!feeds.has(entry[2])) feeds.set(entry[2], entry[1]);
    }
  }

  const total = [...sections.values()].reduce((n, feeds) => n + feeds.size, 0);
  if (total < 20) {
    throw new Error(`only ${total} feeds parsed - the upstream file changed shape?`);
  }

  const current = JSON.parse(await readFile(FEEDS_FILE, 'utf8'));
  current.sections = [...sections.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([key, feeds]) => ({
      name: LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
      feeds: [...feeds.entries()].map(([url, name]) => ({ name, url })),
    }));

  await writeFile(FEEDS_FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`  ${total} feeds in ${current.sections.length} sections -> feeds.json`);
  for (const section of current.sections) {
    console.log(`    ${String(section.feeds.length).padStart(3)}  ${section.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
