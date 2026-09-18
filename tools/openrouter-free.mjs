// Live catalogue of OpenRouter :free models. They come and go, so summarize
// asks /api/v1/models at the start of a run instead of baking in three names.

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

// Used when the catalogue cannot be fetched. General copy-desk models only.
export const FALLBACK_FREE_MODELS = [
  'openrouter/free',
  'nex-agi/nex-n2.5-pro:free',
  'nex-agi/nex-n2.5-mini:free',
  'nvidia/nemotron-3.5-lightning:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'deepseek/deepseek-v4-flash-0731:free',
  'thinkingmachines/inkling-small:free',
  'thinkingmachines/inkling:free',
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'liquid/lfm-2.5-2.6b:free',
  'dots-studio/dots-3-note-preview:free',
];

// Guardrails, coding agents and specialist clinics are a poor newspaper desk.
const SKIP = /content-safety|-sante:|laguna|north-mini-code/;

const FAST_FIRST = [
  'openrouter/free',
  'nex-agi/nex-n2.5-pro:free',
  'nex-agi/nex-n2.5-mini:free',
  'nvidia/nemotron-3.5-lightning:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'deepseek/deepseek-v4-flash-0731:free',
  'thinkingmachines/inkling-small:free',
  'z-ai/glm-5.2:free',
];

function add(list, id) {
  if (id && !list.includes(id)) list.push(id);
}

export async function loadFreeModels({ preferred, fallback = true } = {}) {
  let live = [];
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      live = (data.data || [])
        .map((m) => m && m.id)
        .filter((id) => typeof id === 'string' && id.endsWith(':free') && !SKIP.test(id));
    }
  } catch {
    live = [];
  }
  if (live.length === 0) live = FALLBACK_FREE_MODELS.filter((id) => id !== 'openrouter/free');

  const out = [];
  if (fallback === false) {
    add(out, preferred || live[0] || FALLBACK_FREE_MODELS[1]);
    return out;
  }
  add(out, preferred);
  for (const id of FAST_FIRST) add(out, id);
  for (const id of live) add(out, id);
  return out;
}

export function isRateLimit(err) {
  return /HTTP 429|rate limit/i.test(String(err && err.message));
}

export function isDailyFreeCap(err) {
  return /free-models-per-day/i.test(String(err && err.message));
}
