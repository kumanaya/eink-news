#!/usr/bin/env python3
# Translates each slide into English with Meta's NLLB-200 (600M, CTranslate2
# int8) on CPU. The GitHub Action runs this after fetch-feeds so the board
# never depends on OpenRouter for language.

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

try:
    import ctranslate2
    from huggingface_hub import snapshot_download
    from langdetect import DetectorFactory, detect
    from transformers import AutoTokenizer
except ImportError:
    sys.stderr.write(
        "translate.py needs ctranslate2, transformers, sentencepiece, "
        "huggingface_hub and langdetect\n"
        "  pip install -r tools/requirements-translate.txt\n"
    )
    sys.exit(1)

DetectorFactory.seed = 0

ROOT = Path(__file__).resolve().parent.parent
NEWS_FILE = ROOT / "src" / "data" / "news.json"
MODEL_ID = "entai2965/nllb-200-distilled-600M-ctranslate2"
TARGET = "eng_Latn"
TITLE_CHARS = 90
DESCRIPTION_CHARS = 170
SUMMARY_CHARS = 240

ISO_TO_NLLB = {
    "af": "afr_Latn",
    "ar": "arb_Arab",
    "az": "azj_Latn",
    "be": "bel_Cyrl",
    "bg": "bul_Cyrl",
    "bn": "ben_Beng",
    "bs": "bos_Latn",
    "ca": "cat_Latn",
    "cs": "ces_Latn",
    "cy": "cym_Latn",
    "da": "dan_Latn",
    "de": "deu_Latn",
    "el": "ell_Grek",
    "en": "eng_Latn",
    "es": "spa_Latn",
    "et": "est_Latn",
    "fa": "pes_Arab",
    "fi": "fin_Latn",
    "fr": "fra_Latn",
    "ga": "gle_Latn",
    "gl": "glg_Latn",
    "gu": "guj_Gujr",
    "he": "heb_Hebr",
    "hi": "hin_Deva",
    "hr": "hrv_Latn",
    "hu": "hun_Latn",
    "hy": "hye_Armn",
    "id": "ind_Latn",
    "is": "isl_Latn",
    "it": "ita_Latn",
    "ja": "jpn_Jpan",
    "ka": "kat_Geor",
    "kk": "kaz_Cyrl",
    "km": "khm_Khmr",
    "kn": "kan_Knda",
    "ko": "kor_Hang",
    "lt": "lit_Latn",
    "lv": "lvs_Latn",
    "mk": "mkd_Cyrl",
    "ml": "mal_Mlym",
    "mr": "mar_Deva",
    "ms": "zsm_Latn",
    "nb": "nob_Latn",
    "nl": "nld_Latn",
    "nn": "nno_Latn",
    "no": "nob_Latn",
    "pl": "pol_Latn",
    "pt": "por_Latn",
    "ro": "ron_Latn",
    "ru": "rus_Cyrl",
    "sk": "slk_Latn",
    "sl": "slv_Latn",
    "so": "som_Latn",
    "sq": "als_Latn",
    "sr": "srp_Cyrl",
    "sv": "swe_Latn",
    "sw": "swh_Latn",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "th": "tha_Thai",
    "tl": "tgl_Latn",
    "tr": "tur_Latn",
    "uk": "ukr_Cyrl",
    "ur": "urd_Arab",
    "uz": "uzn_Latn",
    "vi": "vie_Latn",
    "zh-cn": "zho_Hans",
    "zh-tw": "zho_Hant",
    "zh": "zho_Hans",
}


def clip(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip()


def detect_iso(text: str) -> str:
    blob = " ".join(str(text or "").split())
    if len(blob) < 8:
        return "en"
    try:
        return detect(blob)
    except Exception:
        return "en"


def nllb_code(iso: str) -> str:
    return ISO_TO_NLLB.get(iso, TARGET)


def load_model():
    print("  loading NLLB-200 distilled 600M (CPU int8)...", flush=True)
    started = time.time()
    model_dir = snapshot_download(MODEL_ID)
    translator = ctranslate2.Translator(
        model_dir,
        device="cpu",
        compute_type="int8",
        intra_threads=4,
    )
    tokenizer = AutoTokenizer.from_pretrained(model_dir, src_lang=TARGET)
    print(f"  model ready in {time.time() - started:.0f}s", flush=True)
    return translator, tokenizer


def translate_batch(translator, tokenizer, texts: list[str], src_code: str) -> list[str]:
    if not texts:
        return []
    tokenizer.src_lang = src_code
    encoded = [tokenizer.convert_ids_to_tokens(tokenizer.encode(text)) for text in texts]
    results = translator.translate_batch(
        encoded,
        target_prefix=[[TARGET]] * len(encoded),
        beam_size=1,
        max_decoding_length=256,
    )
    out = []
    for row in results:
        hyp = row.hypotheses[0]
        if hyp and hyp[0] == TARGET:
            hyp = hyp[1:]
        out.append(tokenizer.decode(tokenizer.convert_tokens_to_ids(hyp)).strip())
    return out


def main() -> int:
    if not NEWS_FILE.exists():
        print("  no src/data/news.json - run fetch-feeds first", flush=True)
        return 1

    edition = json.loads(NEWS_FILE.read_text())
    slides = edition.get("slides") or []
    jobs = []
    for index, slide in enumerate(slides):
        blob = " ".join(
            part for part in (slide.get("title"), slide.get("description"), slide.get("summary")) if part
        )
        iso = detect_iso(blob or slide.get("title") or "")
        code = nllb_code(iso)
        if code == TARGET:
            continue
        for field, limit in (
            ("title", TITLE_CHARS),
            ("summary", SUMMARY_CHARS),
            ("description", DESCRIPTION_CHARS),
        ):
            value = (slide.get(field) or "").strip()
            if not value:
                continue
            jobs.append((index, field, limit, code, value))

    if not jobs:
        print("  every slide is already English", flush=True)
        return 0

    translator, tokenizer = load_model()
    grouped: dict[str, list[tuple[int, str, int, str]]] = defaultdict(list)
    for index, field, limit, code, value in jobs:
        grouped[code].append((index, field, limit, value))

    translated = 0
    started = time.time()
    for code, batch in grouped.items():
        texts = [item[3] for item in batch]
        print(f"  {code}: {len(texts)} strings...", flush=True)
        english = translate_batch(translator, tokenizer, texts, code)
        for (index, field, limit, _src), line in zip(batch, english):
            if line:
                slides[index][field] = clip(line, limit)
                translated += 1

    NEWS_FILE.write_text(json.dumps(edition, indent=2, ensure_ascii=False) + "\n")
    seconds = time.time() - started
    print(
        f"  {translated} strings into English in {seconds:.0f}s "
        f"({len(slides)} slides)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
