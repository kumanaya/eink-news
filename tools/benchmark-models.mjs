#!/usr/bin/env node
// Times the free models, so the summarizer can use the quickest one.
//
//   node tools/benchmark-models.mjs [calls-per-model]
//
// Free models share a pool and their latency swings wildly (4s to 17s for the
// same call), so a few calls each is enough to tell them apart. Whatever wins
// can be pinned in feeds.json:
//
//   "summaries_model": "vendor/model:free"
//
// With that set, tools/summarize.mjs tries it first, then the rest of the
// live :free catalogue.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFreeModels } from './openrouter-free.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY_FILE = path.join(ROOT, '.openrouter-key');
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const CALLS = Number(process.argv[2]) || 3;
const TIMEOUT_MS = 60000;

const SYSTEM =
  'You are the copy desk of a newspaper. Summarize the story in exactly two ' +
  'sentences, at most 220 characters, plain English, no quotes, no markdown. ' +
  'Answer with the summary only.';

// The same rules the summarizer applies: a fast model that answers with its
// own reasoning is not fast, it is broken.
const ARTIFACTS = /^(final answer( only)?|answer|summary|short summary|here('s| is) the summary|the summary is|resumo)\s*[:\-\u2013\u2014.]*\s*/i;

function isUsable(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length < 60 || !/[.!?]$/.test(trimmed)) return false;
  if (ARTIFACTS.test(trimmed)) return false;
  if (/thinking process|\*\*Analyze|^\s*\d+\.\s/m.test(trimmed)) return false;
  return true;
}

const SAMPLE = {
  title: 'Canada welcomes EU proposal to become associate member',
  description:
    'Canadian Prime Minister Mark Carney said a Canada-EU alliance would create a beacon for other democracies.',
};

function key() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim();
  return '';
}

async function call(model, apiKey) {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Title: ${SAMPLE.title}\n\nText: ${SAMPLE.description}` },
      ],
      max_tokens: 400,
      reasoning: { exclude: true },
      temperature: 0.3,
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${body.slice(0, 60)}`);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!isUsable(text)) throw new Error(`unusable answer: "${text.slice(0, 40)}"`);
  return ms;
}

async function main() {
  const apiKey = key();
  if (!apiKey) {
    console.error('no OpenRouter key (OPENROUTER_API_KEY or .openrouter-key)');
    process.exit(1);
  }

  const models = (await loadFreeModels()).filter((id) => id !== 'openrouter/free');
  console.log(`  ${models.length} free models from OpenRouter\n`);

  const results = [];
  for (const model of models) {
    const times = [];
    for (let i = 1; i <= CALLS; i += 1) {
      process.stdout.write(`  ${model} [${i}/${CALLS}]... `);
      try {
        const ms = await call(model, apiKey);
        times.push(ms);
        console.log(`${(ms / 1000).toFixed(1)}s`);
      } catch (err) {
        console.log(`failed (${err.message.slice(0, 50)})`);
        break;
      }
    }
    if (times.length > 0) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      results.push({ model, avg, times });
    }
  }

  results.sort((a, b) => a.avg - b.avg);
  console.log('\n  fastest first:');
  for (const result of results) {
    console.log(
      `    ${(result.avg / 1000).toFixed(1)}s avg  ${result.model}  (${result.times.map((t) => (t / 1000).toFixed(1)).join(', ')})`
    );
  }
  if (results[0]) {
    console.log(`\n  pin it in feeds.json:\n    "summaries_model": "${results[0].model}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
