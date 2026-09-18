#!/usr/bin/env node
// Writes the summary of each slide, through OpenRouter.
//
//   node tools/summarize.mjs
//
// fetch-feeds leaves `summary` empty; this writes an English headline, dek and
// blurb so the board stays in one language even though the feeds do not.
//
// The key comes from OPENROUTER_API_KEY, or from a .openrouter-key file next to
// this project (git-ignored). Without a key the edition still builds - the
// slides simply show the description alone.
//
// There are hundreds of stories and the free models are slow, so:
// - English copy is cached by story link in src/data/summaries.json (committed),
//   and survives editions (a story keeps its lines when it appears again);
// - each run spends a budget (summaries_per_run in feeds.json), Kindle-first,
//   so the board fills in English instead of reprinting the feed language;
// - the Vercel build never waits on a model.
//
// Free models are shared and rate-limited, so the list is tried in order and a
// slow or busy model never blocks the edition.

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnglishCopy, isUsableSummary, plainText, tidySummary } from './plain-text.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NEWS_FILE = path.join(ROOT, 'src', 'data', 'news.json');
const CACHE_FILE = path.join(ROOT, 'src', 'data', 'summaries.json');
const FEEDS_FILE = path.join(ROOT, 'feeds.json');
const KEY_FILE = path.join(ROOT, '.openrouter-key');
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Tried in order; the one that answers is kept for the rest of the run.
// feeds.json may name its own favourite in `summaries_model`, which goes
// first - all of them are free models, so they come and go.
const MODELS = [
  'nex-agi/nex-n2.5-pro:free',
  'nvidia/nemotron-3.5-lightning:free',
  'qwen/qwen3.8-27b:free',
];
const MAX_SUMMARY_CHARS = 240;
const MAX_HEADLINE_CHARS = 90;
const MAX_BLURB_CHARS = 170;
const TIMEOUT_MS = 60000;

const SYSTEM_PROMPT =
  'You are a newspaper copy desk. Stories arrive in any language. You write English only. ' +
  'Reply with exactly three lines and nothing else:\n' +
  'HEADLINE: <one English headline, max 90 characters, no trailing ellipsis>\n' +
  'DEK: <exactly two English sentences, at most 220 characters, facts the headline does not say>\n' +
  'BLURB: <one or two English sentences from the feed text, at most 170 characters>\n' +
  'Plain text only: no HTML, no markdown, no quotes, no opinions, no preamble.';

function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (existsSync(KEY_FILE)) {
    try {
      return readFileSync(KEY_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

async function ask(model, key, slide) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/kumanaya/eink-news',
      'x-title': 'E-INK NEWS',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Headline: ${slide.title}\n\n` +
            `Story: ${plainText(slide.description || '').slice(0, 700) || '(no extra text)'}\n\n` +
            'Write HEADLINE, DEK and BLURB in English.',
        },
      ],
      max_tokens: 500,
      reasoning: { exclude: true },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  return parseCopy(data.choices?.[0]?.message?.content || '');
}

function lineValue(text, name) {
  const m = String(text || '').match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return m ? m[1].trim() : '';
}

function parseCopy(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const headline = plainText(lineValue(text, 'HEADLINE')).replace(/\u2026+$/g, '').trim();
  const dek = tidySummary(lineValue(text, 'DEK') || (!lineValue(text, 'HEADLINE') ? text : ''), MAX_SUMMARY_CHARS);
  const blurb = plainText(lineValue(text, 'BLURB'));
  return {
    headline: headline.length > MAX_HEADLINE_CHARS
      ? `${headline.slice(0, MAX_HEADLINE_CHARS).replace(/\s+\S*$/, '')}`
      : headline,
    dek,
    blurb: blurb.length > MAX_BLURB_CHARS
      ? `${blurb.slice(0, MAX_BLURB_CHARS).replace(/\s+\S*$/, '')}`
      : blurb,
  };
}

function isGoodCopy(copy, slide) {
  if (!copy || !isUsableSummary(copy.dek, copy.headline || slide.title)) return false;
  if (!copy.headline || copy.headline.length < 12 || !isEnglishCopy(copy.headline)) return false;
  if (!isEnglishCopy(copy.dek)) return false;
  if (slide.description && (!copy.blurb || !isEnglishCopy(copy.blurb))) return false;
  return true;
}

function fromCache(known) {
  if (!known) return null;
  if (typeof known === 'string') return { headline: '', dek: known, blurb: '' };
  if (known.dek) return known;
  return null;
}

function needsCopy(slide) {
  if (!slide || !slide.title) return true;
  if (!isEnglishCopy(slide.title)) return true;
  if (!isUsableSummary(slide.summary, slide.title)) return true;
  if (slide.description && !isEnglishCopy(slide.description)) return true;
  return false;
}

const settings = existsSync(FEEDS_FILE) ? JSON.parse(readFileSync(FEEDS_FILE, 'utf8')) : {};

const cacheKey = (slide) => (slide.link || slide.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
const titleKey = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function lookupCache(cache, slide) {
  return fromCache(cache[cacheKey(slide)] || cache[titleKey(slide.title)]);
}

async function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  if (!existsSync(NEWS_FILE)) {
    console.warn('  no src/data/news.json - run "npm run news" first');
    return;
  }

  const edition = JSON.parse(await readFile(NEWS_FILE, 'utf8'));
  const cache = await loadCache();

  // Drop HTML leftovers, headline-echo lines, and copy that is not English, so
  // a re-run repairs the board instead of reprinting the damage from last time.
  // Cached English copy is kept: the same story should not pay the API twice.
  for (const slide of edition.slides) {
    slide.description = plainText(slide.description);
    if (slide.summary && (!isUsableSummary(slide.summary, slide.title) || !isEnglishCopy(slide.summary))) {
      slide.summary = '';
    }
  }

  let cached = 0;
  for (const slide of edition.slides) {
    const known = lookupCache(cache, slide);
    if (!known) continue;
    // Old cache entries were a dek string only. Skip them when the headline
    // is still in the feed language, so the desk rewrites the whole card.
    if (!known.headline && !isEnglishCopy(slide.title)) continue;
    if (known.headline && isEnglishCopy(known.headline)) slide.title = known.headline;
    if (known.blurb && isEnglishCopy(known.blurb)) slide.description = known.blurb;
    if (isUsableSummary(known.dek, slide.title) && isEnglishCopy(known.dek)) {
      slide.summary = known.dek;
      cached += 1;
    }
  }

  const budget = Number(settings.summaries_per_run) || 40;
  const rendered = Number(settings.render_slides) || 100;
  const pending = [
    ...edition.slides.slice(0, rendered),
    ...edition.slides.slice(rendered),
  ].filter((slide) => needsCopy(slide)).slice(0, budget);

  if (pending.length === 0) {
    await writeFile(NEWS_FILE, JSON.stringify(edition, null, 2) + '\n');
    console.log(`  every slide is in English (${cached} came from the cache)`);
    return;
  }

  const key = readKey();
  if (!key) {
    console.warn('  no OpenRouter key (OPENROUTER_API_KEY or .openrouter-key); summaries skipped');
    await writeFile(NEWS_FILE, JSON.stringify(edition, null, 2) + '\n');
    return;
  }
  console.log(`  ${pending.length} to write this run (budget ${budget}, ${cached} from cache)`);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Each summary is a round trip to a shared free model, and they are slow:
  // measured between 4 and 17 seconds each. Doing them one at a time made the
  // whole pipeline take ten minutes, so a few are in flight at once - the
  // retry below catches the rate limits that invites.
  const concurrency = Number(settings.summaries_concurrency) || 3;
  const preferred = settings.summaries_model;
  if (preferred) {
    if (settings.summaries_fallback === false) {
      MODELS.length = 0; // one model only, as asked
    }
    MODELS.splice(0, 0, preferred);
    console.log(`  model: ${preferred}${settings.summaries_fallback === false ? ' (no fallback)' : ''}`);
  }
  const started = Date.now();
  let model = MODELS[0];
  let done = 0;

  const summarizeOne = async (slide) => {
    let copy = null;
    let lastError = '';
    for (let round = 1; round <= 3 && !copy; round += 1) {
      for (const candidate of [model, ...MODELS.filter((m) => m !== model)]) {
        try {
          const answer = await ask(candidate, key, slide);
          if (!isGoodCopy(answer, slide)) {
            throw new Error(`unusable answer: "${(answer.dek || '').slice(0, 50)}"`);
          }
          copy = answer;
          model = candidate;
          break;
        } catch (err) {
          lastError = `${candidate.split('/')[0]}: ${err.message}`;
        }
      }
      if (!copy && round < 3) await sleep(round * 5000);
    }

    if (copy) {
      const key = cacheKey(slide);
      slide.title = copy.headline;
      slide.summary = copy.dek;
      if (copy.blurb) slide.description = copy.blurb;
      cache[key] = copy;
    }
    done += 1;
    const how = copy ? `ok (${model.split('/')[0]})` : `no copy (${lastError})`;
    console.log(`  ${String(done).padStart(3)}/${pending.length} ${how} — ${(copy ? copy.headline : slide.title).slice(0, 44)}`);
    return copy;
  };

  // Small pool: `concurrency` summaries in flight.
  let next = 0;
  await Promise.all(
    new Array(Math.min(concurrency, pending.length)).fill(0).map(async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= pending.length) return;
        await summarizeOne(pending[index]);
      }
    })
  );

  await writeFile(NEWS_FILE, JSON.stringify(edition, null, 2) + '\n');
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
  const english = edition.slides.filter((slide) => isEnglishCopy(slide.title) && isUsableSummary(slide.summary, slide.title)).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  ${english}/${edition.slides.length} slides in English in ${seconds}s (${concurrency} at a time)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
