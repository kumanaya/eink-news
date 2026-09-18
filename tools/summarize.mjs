#!/usr/bin/env node
// Writes the summary of each slide, through OpenRouter.
//
//   node tools/summarize.mjs
//
// fetch-feeds leaves `summary` empty; this fills it with two plain sentences
// for the board, keeping the feed text as the description below.
//
// The key comes from OPENROUTER_API_KEY, or from a .openrouter-key file next to
// this project (git-ignored). Without a key the edition still builds - the
// slides simply show the description alone.
//
// There are hundreds of stories and the free models are slow, so:
// - summaries are cached by headline in src/data/summaries.json (committed),
//   and survive editions (a story keeps its line when it appears again);
// - each run spends a budget (summaries_per_run in feeds.json), so the board
//   fills up over the following Actions runs instead of hammering the API
//   all at once, and the Vercel build never waits on a model.
//
// Free models are shared and rate-limited, so the list is tried in order and a
// slow or busy model never blocks the edition.

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const TIMEOUT_MS = 60000;

const SYSTEM_PROMPT =
  'You are the copy desk of a newspaper. Summarize the story for a front-page ' +
  'board in exactly two sentences, at most 220 characters, plain English, ' +
  'factual, no quotes, no opinions, no markdown. Answer with the summary only.';

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
      // OpenRouter uses these for attribution; they are optional.
      'http-referer': 'https://github.com/kumanaya/eink-news',
      'x-title': 'E-INK NEWS',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Title: ${slide.title}\n\nText: ${(slide.description || slide.title).slice(0, 700)}`,
        },
      ],
      // Generous, because some models spend tokens thinking before answering;
      // reasoning is excluded from the answer itself.
      max_tokens: 400,
      reasoning: { exclude: true },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return clean(raw);
}

// A summary is only accepted when it reads like one: long enough to say
// something, and finished. Free models occasionally return nothing, or stop
// mid-sentence, and a broken line on the board is worse than no line.
function isGoodSummary(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 60 || !/[.!?]$/.test(trimmed)) return false;
  // A leftover like "Final answer only." means the answer was not the summary.
  return !ARTIFACTS.test(trimmed);
}

// Models sometimes add reasoning, quotes or a preamble; keep the summary.
// "Final answer only." and friends are the usual leftovers.
const ARTIFACTS =
  /^(final answer( only)?|answer|summary|short summary|here('s| is) the summary|the summary is|resumo)\s*[:\-\u2013\u2014.]*\s*/i;

function clean(text) {
  let out = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let before;
  do {
    before = out;
    out = out.replace(ARTIFACTS, '').trim();
  } while (out !== before);
  out = out.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (out.length > MAX_SUMMARY_CHARS) {
    const cut = out.slice(0, MAX_SUMMARY_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    out = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '\u2026';
  }
  return out;
}

const settings = existsSync(FEEDS_FILE) ? JSON.parse(readFileSync(FEEDS_FILE, 'utf8')) : {};

const cacheKey = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

  // Whatever is already known is applied first, so the board keeps the lines it
  // has even when the API is unreachable.
  let fromCache = 0;
  for (const slide of edition.slides) {
    const known = cache[cacheKey(slide.title)];
    if (!slide.summary && isGoodSummary(known)) {
      slide.summary = known;
      fromCache += 1;
    }
  }

  const budget = Number(settings.summaries_per_run) || 40;
  // Anything that failed validation last time is retried, so re-running the
  // command repairs a bad edition instead of keeping the damage.
  const pending = edition.slides
    .filter((slide) => !isGoodSummary(slide.summary) && slide.title)
    .slice(0, budget);

  if (pending.length === 0) {
    await writeFile(NEWS_FILE, JSON.stringify(edition, null, 2) + '\n');
    console.log(`  every slide has a summary (${fromCache} came from the cache)`);
    return;
  }

  const key = readKey();
  if (!key) {
    console.warn('  no OpenRouter key (OPENROUTER_API_KEY or .openrouter-key); summaries skipped');
    await writeFile(NEWS_FILE, JSON.stringify(edition, null, 2) + '\n');
    return;
  }
  console.log(`  ${pending.length} to write this run (budget ${budget}, ${fromCache} from cache)`);

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
    let text = '';
    let lastError = '';
    // Free models are shared: a 429 or a truncated answer is normal, so the
    // slide gets three passes over the model list, with a growing pause.
    for (let round = 1; round <= 3 && !text; round += 1) {
      for (const candidate of [model, ...MODELS.filter((m) => m !== model)]) {
        try {
          const answer = await ask(candidate, key, slide);
          if (!isGoodSummary(answer)) {
            throw new Error(`unusable answer: "${answer.slice(0, 50)}"`);
          }
          text = answer;
          model = candidate; // stay on whatever worked
          break;
        } catch (err) {
          lastError = `${candidate.split('/')[0]}: ${err.message}`;
        }
      }
      if (!text && round < 3) await sleep(round * 5000);
    }

    slide.summary = text;
    if (text) cache[cacheKey(slide.title)] = text;
    done += 1;
    const how = text ? `ok (${model.split('/')[0]})` : `no summary (${lastError})`;
    console.log(`  ${String(done).padStart(3)}/${pending.length} ${how} — ${slide.title.slice(0, 44)}`);
    return text;
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
  const written = edition.slides.filter((slide) => slide.summary).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  ${written}/${edition.slides.length} slides have a summary in ${seconds}s (${concurrency} at a time)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
