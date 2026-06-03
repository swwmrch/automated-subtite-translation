# KMTV Local Subtitle Translator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone macOS double-click CLI tool at `~/KMTV-Translate/` that translates Korean `.srt` files into EN/TC/TW via arrow-key menus and auto-manages files in dated Archive folders.

**Architecture:** A single `translate.py` script holds all logic — SRT parsing, OpenAI prompts, batch translation, file management, and the `questionary`-powered CLI. A `translate.command` shell stub opens Terminal and runs it. Tests live in `tests/test_translate.py` and cover all pure functions and the translation engine via mocked OpenAI calls; the CLI flow is verified via manual smoke test.

**Tech Stack:** Python 3.11+, `openai` (v1+), `questionary` (v2+), `python-dotenv`, `pytest`

---

## File Map

| File | Role |
|------|------|
| `~/KMTV-Translate/translate.py` | Entire tool — SRT utils, prompts, engine, file mgmt, CLI |
| `~/KMTV-Translate/translate.command` | macOS launcher — opens Terminal and runs translate.py |
| `~/KMTV-Translate/.env` | `OPENAI_API_KEY=sk-...` |
| `~/KMTV-Translate/requirements.txt` | Pinned dependencies |
| `~/KMTV-Translate/tests/conftest.py` | Adds project root to sys.path for imports |
| `~/KMTV-Translate/tests/test_translate.py` | All automated tests |
| `~/KMTV-Translate/INPUT/` | User drops .srt files here |
| `~/KMTV-Translate/OUTPUT/` | Translated files appear here |
| `~/KMTV-Translate/ARCHIVE/` | Manual cleanup moves files here |

> **All paths below are relative to `~/KMTV-Translate/`** (i.e. `/Users/march/KMTV-Translate/`). This is a new project — nothing is created inside the Next.js repo.

---

## Task 1: Scaffold the project directory

**Files:**
- Create: `~/KMTV-Translate/translate.py`
- Create: `~/KMTV-Translate/translate.command`
- Create: `~/KMTV-Translate/.env`
- Create: `~/KMTV-Translate/requirements.txt`
- Create: `~/KMTV-Translate/tests/conftest.py`
- Create: `~/KMTV-Translate/tests/test_translate.py`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p ~/KMTV-Translate/{INPUT,OUTPUT,ARCHIVE,tests}
```

- [ ] **Step 2: Create `requirements.txt`**

```
openai>=1.0.0
questionary>=2.0.0
python-dotenv>=1.0.0
pytest>=8.0.0
```

- [ ] **Step 3: Install dependencies**

```bash
pip install openai questionary python-dotenv pytest
```

Expected: All packages install without errors.

- [ ] **Step 4: Create `.env`**

```
OPENAI_API_KEY=sk-YOUR_KEY_HERE
```

Replace `sk-YOUR_KEY_HERE` with your actual key. This file is never committed.

- [ ] **Step 5: Create `translate.command`** (the macOS double-click launcher)

```bash
#!/bin/bash
cd "$(dirname "$0")"
python3 translate.py
```

- [ ] **Step 6: Make `translate.command` executable**

```bash
chmod +x ~/KMTV-Translate/translate.command
```

- [ ] **Step 7: Create the initial `translate.py` skeleton** with imports and constants only

```python
#!/usr/bin/env python3
"""KMTV Local Subtitle Translator"""

import os
import re
import time
import shutil
from pathlib import Path
from datetime import datetime

import questionary
from openai import OpenAI
from dotenv import load_dotenv

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
INPUT_DIR   = BASE / "INPUT"
OUTPUT_DIR  = BASE / "OUTPUT"
ARCHIVE_DIR = BASE / "ARCHIVE"

# ── Config ────────────────────────────────────────────────────────────────────
BATCH_SIZE       = 10
MAX_RETRIES      = 3
BATCH_SLEEP      = 1.5
RETRY_SLEEP      = 5.0
MAX_NOTES_LENGTH = 300

LANG_LABELS = {
    "EN": "English (EN)",
    "TC": "Traditional Chinese — Taiwan (TC)",
    "TW": "Taiwanese Hokkien (TW)",
}
MODEL_LABELS = {
    "gpt-4o":      "GPT-4o        (best quality)",
    "gpt-4o-mini": "GPT-4o mini   (faster, cheaper)",
}
```

- [ ] **Step 8: Create `tests/conftest.py`** so pytest can import `translate.py`

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
```

- [ ] **Step 9: Create `tests/test_translate.py`** with a placeholder

```python
"""Tests for translate.py"""
```

- [ ] **Step 10: Verify pytest runs (zero tests is fine)**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected output contains: `no tests ran` or `0 passed`.

- [ ] **Step 11: Commit**

```bash
cd ~/KMTV-Translate && git init && git add translate.py translate.command requirements.txt tests/
git commit -m "feat: scaffold KMTV local CLI project"
```

> Note: do **not** `git add .env` — the API key must stay out of version control.

---

## Task 2: SRT utilities

**Files:**
- Modify: `translate.py` — add `parse_srt`, `blocks_to_raw_strings`, `parse_translated_blocks`, `fix_srt_numbering`
- Modify: `tests/test_translate.py` — add SRT utility tests

- [ ] **Step 1: Write the failing tests** — add to `tests/test_translate.py`

```python
from translate import (
    parse_srt,
    blocks_to_raw_strings,
    parse_translated_blocks,
    fix_srt_numbering,
)


def test_parse_srt_basic():
    content = "1\n00:00:01,000 --> 00:00:03,000\n안녕하세요\n\n2\n00:00:04,000 --> 00:00:06,000\n잘 지내요?"
    result = parse_srt(content)
    assert len(result) == 2
    assert result[0] == {"index": 1, "timestamp": "00:00:01,000 --> 00:00:03,000", "text": "안녕하세요"}
    assert result[1] == {"index": 2, "timestamp": "00:00:04,000 --> 00:00:06,000", "text": "잘 지내요?"}


def test_parse_srt_windows_line_endings():
    content = "1\r\n00:00:01,000 --> 00:00:03,000\r\n안녕하세요"
    result = parse_srt(content)
    assert len(result) == 1
    assert result[0]["text"] == "안녕하세요"


def test_parse_srt_multiline_text():
    content = "1\n00:00:01,000 --> 00:00:03,000\n첫 번째 줄\n두 번째 줄"
    result = parse_srt(content)
    assert result[0]["text"] == "첫 번째 줄\n두 번째 줄"


def test_parse_srt_skips_invalid_blocks():
    content = "bad\n00:00:01,000 --> 00:00:03,000\n텍스트\n\n1\n00:00:04,000 --> 00:00:06,000\n유효"
    result = parse_srt(content)
    assert len(result) == 1
    assert result[0]["text"] == "유효"


def test_parse_srt_empty_string():
    assert parse_srt("") == []


def test_blocks_to_raw_strings():
    blocks = [{"index": 1, "timestamp": "00:00:01,000 --> 00:00:03,000", "text": "안녕"}]
    result = blocks_to_raw_strings(blocks)
    assert result == ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]


def test_blocks_to_raw_strings_multiline():
    blocks = [{"index": 3, "timestamp": "00:00:01,000 --> 00:00:03,000", "text": "line1\nline2"}]
    result = blocks_to_raw_strings(blocks)
    assert result == ["3\n00:00:01,000 --> 00:00:03,000\nline1\nline2"]


def test_parse_translated_blocks_basic():
    raw = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nHow are you?"
    result = parse_translated_blocks(raw)
    assert len(result) == 2
    assert "Hello" in result[0]
    assert "How are you?" in result[1]


def test_parse_translated_blocks_filters_commentary():
    raw = "Some GPT commentary\n\n1\n00:00:01,000 --> 00:00:03,000\nHello"
    result = parse_translated_blocks(raw)
    assert len(result) == 1
    assert "Hello" in result[0]


def test_fix_srt_numbering_renumbers():
    blocks = [
        "5\n00:00:01,000 --> 00:00:03,000\nHello",
        "10\n00:00:04,000 --> 00:00:06,000\nWorld",
    ]
    result = fix_srt_numbering(blocks)
    assert result[0].startswith("1\n")
    assert result[1].startswith("2\n")


def test_fix_srt_numbering_preserves_timestamp_and_text():
    blocks = ["99\n00:00:01,000 --> 00:00:03,000\nHello"]
    result = fix_srt_numbering(blocks)
    assert "00:00:01,000 --> 00:00:03,000" in result[0]
    assert "Hello" in result[0]
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: `ImportError` — functions not yet defined in `translate.py`.

- [ ] **Step 3: Implement the four SRT utility functions** — add after the constants in `translate.py`

```python
# ── SRT utilities ─────────────────────────────────────────────────────────────

def parse_srt(content: str) -> list[dict]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    raw_blocks = normalized.strip().split("\n\n")
    blocks = []
    for block in raw_blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0].strip())
        except ValueError:
            continue
        timestamp = lines[1].strip()
        text = "\n".join(lines[2:]).strip()
        if "-->" not in timestamp or not text:
            continue
        blocks.append({"index": index, "timestamp": timestamp, "text": text})
    return blocks


def blocks_to_raw_strings(blocks: list[dict]) -> list[str]:
    return [f"{b['index']}\n{b['timestamp']}\n{b['text']}" for b in blocks]


def parse_translated_blocks(raw: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    return [p for p in parts if "-->" in p]


def fix_srt_numbering(blocks: list[str]) -> list[str]:
    fixed = []
    for i, block in enumerate(blocks, start=1):
        lines = block.splitlines()
        if not lines:
            continue
        lines[0] = str(i)
        if len(lines) >= 3 and "-->" in lines[1]:
            fixed.append("\n".join(lines))
        elif len(lines) >= 2 and any("-->" in ln for ln in lines):
            ts = next((ln for ln in lines if "-->" in ln), "")
            text_lines = [ln for ln in lines if "-->" not in ln and ln != str(i)]
            if ts and text_lines:
                fixed.append(f"{i}\n{ts}\n" + "\n".join(text_lines))
    return fixed
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/KMTV-Translate && git add translate.py tests/test_translate.py
git commit -m "feat: SRT parsing and formatting utilities"
```

---

## Task 3: Translation prompts

**Files:**
- Modify: `translate.py` — add `build_system_prompt`, `_output_rules`, `build_user_prompt`
- Modify: `tests/test_translate.py` — add prompt tests

- [ ] **Step 1: Write the failing tests** — append to `tests/test_translate.py`

```python
from translate import build_system_prompt, build_user_prompt


def test_system_prompt_en_base_content():
    prompt = build_system_prompt("EN")
    assert "Korean subtitle translator" in prompt
    assert "K-dramas" in prompt


def test_system_prompt_en_no_tc_tw_content():
    prompt = build_system_prompt("EN")
    assert "Taiwan" not in prompt
    assert "Hokkien" not in prompt


def test_system_prompt_tc_taiwan_mandarin():
    prompt = build_system_prompt("TC")
    assert "Taiwan" in prompt
    assert "Mainland Chinese" in prompt


def test_system_prompt_tw_hokkien():
    prompt = build_system_prompt("TW")
    assert "Hokkien" in prompt
    assert "教育部" in prompt


def test_user_prompt_en_block_count():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕", "2\n00:00:04,000 --> 00:00:06,000\n잘 지내요"]
    prompt = build_user_prompt(blocks, "EN", "")
    assert "2 Korean SRT subtitle blocks" in prompt
    assert "Return exactly 2 blocks" in prompt


def test_user_prompt_en_honorific_rules():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "EN", "")
    assert "unnie" in prompt
    assert "oppa" in prompt


def test_user_prompt_tc_taiwan_vocab():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "TC", "")
    assert "捷運" in prompt
    assert "Mainland Chinese" in prompt


def test_user_prompt_tw_hokkien_rules():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "TW", "")
    assert "漢字" in prompt
    assert "教育部" in prompt


def test_user_prompt_notes_appended():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "EN", "Romantic K-drama")
    assert "Romantic K-drama" in prompt


def test_user_prompt_no_notes_no_context_line():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "EN", "")
    assert "Context from user" not in prompt


def test_user_prompt_body_contains_blocks():
    blocks = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    prompt = build_user_prompt(blocks, "EN", "")
    assert "00:00:01,000 --> 00:00:03,000" in prompt
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/KMTV-Translate && pytest tests/ -v -k "system_prompt or user_prompt"
```

Expected: `ImportError` for `build_system_prompt` and `build_user_prompt`.

- [ ] **Step 3: Implement prompt functions** — add after the SRT utilities in `translate.py`

```python
# ── Translation prompts ───────────────────────────────────────────────────────

def build_system_prompt(lang: str) -> str:
    base = (
        "You are a professional Korean subtitle translator specializing in Korean entertainment — "
        "K-dramas, variety shows, and TV programmes. "
        "You preserve the natural emotional tone, conversational rhythm, and cultural nuance of every line. "
        "You are expert at Korean honorifics, onomatopoeia, and subtitle formatting."
    )
    if lang == "TC":
        return base + (
            " You translate into Traditional Chinese as used in Taiwan (台灣繁體中文/台灣華語). "
            "You use Taiwan Mandarin vocabulary naturally and avoid all Mainland Chinese expressions."
        )
    if lang == "TW":
        return base + (
            " You translate into authentic Taiwanese Hokkien (台語/臺語) written in Chinese characters (漢字), "
            "following the character standards of Taiwan's Ministry of Education (教育部台灣閩南語推薦用字)."
        )
    return base


def _output_rules(count: int, context_line: str, body: str) -> str:
    return (
        f"\nOutput format:\n"
        f"- Exact SRT structure: index number → timestamp → translated text\n"
        f"- Return exactly {count} blocks — no merging, no splitting\n"
        f"- Return ONLY the SRT blocks — no commentary, no extra text"
        f"{context_line}\n\n---\n\n{body}"
    )


def build_user_prompt(blocks: list[str], lang: str, notes: str) -> str:
    count = len(blocks)
    body = "\n\n".join(blocks)
    context_line = f"\nContext from user: {notes}" if notes else ""

    if lang == "TC":
        return (
            f"Translate the {count} Korean SRT subtitle blocks below into Traditional Chinese (台灣華語/繁體中文).\n\n"
            "Guidelines:\n"
            "- Use Taiwan Mandarin vocabulary: 捷運 not 地鐵, 計程車 not 出租車, 機車 not 摩托車\n"
            "- Avoid Simplified Chinese characters and Mainland Chinese expressions\n"
            "- Render Korean honorifics naturally: 언니→姊姊, 오빠→哥哥/歐巴, 선배→學長/學姐, 아저씨→大叔/叔叔\n"
            "- Transliterate Korean names using Taiwan phonetic conventions\n"
            "- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n"
            "- Keep subtitles concise and screen-readable"
            + _output_rules(count, context_line, body)
        )
    if lang == "TW":
        return (
            f"Translate the {count} Korean SRT subtitle blocks below into Taiwanese Hokkien (台語/臺語).\n\n"
            "Guidelines:\n"
            "- Write in Chinese characters (漢字) following 教育部台灣閩南語推薦用字\n"
            "- Use authentic Taiwanese Hokkien — not Mandarin words pronounced in Taiwanese\n"
            "- For concepts without a direct Hokkien equivalent, choose the closest natural Hokkien expression\n"
            "- Render Korean honorifics in Hokkien: 언니→阿姊, 오빠→阿兄, 선배→學長/前輩\n"
            "- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n"
            "- Keep subtitles concise and screen-readable"
            + _output_rules(count, context_line, body)
        )
    return (
        f"Translate the {count} Korean SRT subtitle blocks below into natural English.\n\n"
        "Guidelines:\n"
        '- Render Korean honorifics naturally: 언니→"unnie", 오빠→"oppa", 선배→"sunbae", 아저씨→"mister" (adapt to context)\n'
        "- Keep Korean names romanized (e.g. 민준→Min-jun, 지수→Ji-su)\n"
        "- Convert Korean onomatopoeia to natural English equivalents (ㅋㅋ→laughter, ㅠㅠ→sadness)\n"
        "- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n"
        "- Keep subtitles concise and screen-readable"
        + _output_rules(count, context_line, body)
    )
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: all tests pass (SRT utilities + prompt tests).

- [ ] **Step 5: Commit**

```bash
cd ~/KMTV-Translate && git add translate.py tests/test_translate.py
git commit -m "feat: translation prompt builders (EN/TC/TW)"
```

---

## Task 4: Translation engine

**Files:**
- Modify: `translate.py` — add `translate_batch`, `translate_file`
- Modify: `tests/test_translate.py` — add engine tests

- [ ] **Step 1: Write the failing tests** — append to `tests/test_translate.py`

```python
from unittest.mock import MagicMock, patch
from translate import translate_batch, translate_file


def _make_client(response_text: str) -> MagicMock:
    client = MagicMock()
    choice = MagicMock()
    choice.message.content = response_text
    client.chat.completions.create.return_value.choices = [choice]
    return client


def test_translate_batch_returns_translated_blocks():
    response = "1\n00:00:01,000 --> 00:00:03,000\nHello"
    client = _make_client(response)
    result = translate_batch(client, ["1\n00:00:01,000 --> 00:00:03,000\n안녕"], "EN", "gpt-4o", "")
    assert len(result) == 1
    assert "Hello" in result[0]


def test_translate_batch_falls_back_on_count_mismatch():
    client = _make_client("")  # empty → zero translated blocks
    korean = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    with patch("translate.time.sleep"):
        result = translate_batch(client, korean, "EN", "gpt-4o", "")
    assert result == korean


def test_translate_batch_falls_back_on_api_exception():
    client = MagicMock()
    client.chat.completions.create.side_effect = Exception("API error")
    korean = ["1\n00:00:01,000 --> 00:00:03,000\n안녕"]
    with patch("translate.time.sleep"):
        result = translate_batch(client, korean, "EN", "gpt-4o", "")
    assert result == korean


def test_translate_batch_passes_system_prompt():
    response = "1\n00:00:01,000 --> 00:00:03,000\nHello"
    client = _make_client(response)
    translate_batch(client, ["1\n00:00:01,000 --> 00:00:03,000\n안녕"], "TC", "gpt-4o", "")
    call_args = client.chat.completions.create.call_args
    messages = call_args.kwargs["messages"]
    assert messages[0]["role"] == "system"
    assert "Taiwan" in messages[0]["content"]


def test_translate_file_writes_output(tmp_path, monkeypatch):
    input_path = tmp_path / "ep01_KO.srt"
    input_path.write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n안녕\n\n2\n00:00:05,000 --> 00:00:07,000\n잘 지내요",
        encoding="utf-8",
    )

    def mock_translate_batch(client, batch, lang, model, notes):
        return [
            b.replace("안녕", "Hello").replace("잘 지내요", "How are you?")
            for b in batch
        ]

    monkeypatch.setattr("translate.translate_batch", mock_translate_batch)
    monkeypatch.setattr("translate.BATCH_SLEEP", 0)

    client = MagicMock()
    results = translate_file(client, input_path, ["EN"], "gpt-4o", "")

    assert "EN" in results
    content, block_count = results["EN"]
    assert block_count == 2
    assert "Hello" in content
    assert "How are you?" in content


def test_translate_file_renumbers_blocks(tmp_path, monkeypatch):
    input_path = tmp_path / "ep01_KO.srt"
    input_path.write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n안녕", encoding="utf-8"
    )

    def mock_translate_batch(client, batch, lang, model, notes):
        return ["99\n00:00:01,000 --> 00:00:03,000\nHello"]  # wrong index

    monkeypatch.setattr("translate.translate_batch", mock_translate_batch)
    monkeypatch.setattr("translate.BATCH_SLEEP", 0)

    client = MagicMock()
    results = translate_file(client, input_path, ["EN"], "gpt-4o", "")
    content, _ = results["EN"]
    # First block must be numbered 1
    assert content.startswith("1\n")
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/KMTV-Translate && pytest tests/ -v -k "translate_batch or translate_file"
```

Expected: `ImportError` for `translate_batch` and `translate_file`.

- [ ] **Step 3: Implement `translate_batch` and `translate_file`** — add after prompt functions in `translate.py`

```python
# ── Translation engine ────────────────────────────────────────────────────────

def translate_batch(
    client: OpenAI,
    batch: list[str],
    lang: str,
    model: str,
    notes: str,
) -> list[str]:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            res = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": build_system_prompt(lang)},
                    {"role": "user",   "content": build_user_prompt(batch, lang, notes)},
                ],
                temperature=0.2,
            )
            translated = parse_translated_blocks(res.choices[0].message.content.strip())
            if len(translated) == len(batch):
                return translated
        except Exception:
            pass
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_SLEEP)
    return batch  # fallback: return Korean unchanged


def translate_file(
    client: OpenAI,
    input_path: Path,
    langs: list[str],
    model: str,
    notes: str,
) -> dict[str, tuple[str, int]]:
    """Returns {lang: (srt_content, block_count)}"""
    content = input_path.read_text(encoding="utf-8")
    blocks = parse_srt(content)
    raw_blocks = blocks_to_raw_strings(blocks)
    total_batches = max(1, (len(raw_blocks) + BATCH_SIZE - 1) // BATCH_SIZE)
    results: dict[str, tuple[str, int]] = {}

    for lang in langs:
        print(f"\n  {LANG_LABELS[lang]}")
        translated: list[str] = []
        for i in range(0, len(raw_blocks), BATCH_SIZE):
            batch = raw_blocks[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            pct = int(batch_num / total_batches * 20)
            bar = "█" * pct + "░" * (20 - pct)
            print(f"\r    Batch {batch_num}/{total_batches}  [{bar}]", end="", flush=True)
            translated.extend(translate_batch(client, batch, lang, model, notes))
            if i + BATCH_SIZE < len(raw_blocks):
                time.sleep(BATCH_SLEEP)
        print()
        fixed = fix_srt_numbering(translated)
        srt_content = "\n\n".join(fixed) + "\n"
        results[lang] = (srt_content, len(fixed))

    return results
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/KMTV-Translate && git add translate.py tests/test_translate.py
git commit -m "feat: batch translation engine with retry and fallback"
```

---

## Task 5: File management

**Files:**
- Modify: `translate.py` — add `get_input_files`, `output_path`, `archive_all`
- Modify: `tests/test_translate.py` — add file management tests

- [ ] **Step 1: Write the failing tests** — append to `tests/test_translate.py`

```python
from translate import get_input_files, output_path, archive_all


def test_output_path_strips_ko_suffix():
    result = output_path(Path("INPUT/episode01_KO.srt"), "EN")
    assert result.name == "episode01_EN.srt"


def test_output_path_strips_ko_suffix_case_insensitive():
    result = output_path(Path("INPUT/episode01_ko.srt"), "TC")
    assert result.name == "episode01_TC.srt"


def test_output_path_no_ko_suffix():
    result = output_path(Path("INPUT/episode01.srt"), "TC")
    assert result.name == "episode01_TC.srt"


def test_get_input_files_returns_srt_files(tmp_path, monkeypatch):
    input_dir = tmp_path / "INPUT"
    input_dir.mkdir()
    (input_dir / "ep01_KO.srt").write_text("content")
    (input_dir / "ep02_KO.srt").write_text("content")
    (input_dir / "notes.txt").write_text("not an srt")
    monkeypatch.setattr("translate.INPUT_DIR", input_dir)
    files = get_input_files()
    assert len(files) == 2
    assert all(f.suffix == ".srt" for f in files)


def test_get_input_files_empty(tmp_path, monkeypatch):
    input_dir = tmp_path / "INPUT"
    input_dir.mkdir()
    monkeypatch.setattr("translate.INPUT_DIR", input_dir)
    assert get_input_files() == []


def test_archive_all_moves_files(tmp_path, monkeypatch):
    input_dir = tmp_path / "INPUT"
    output_dir = tmp_path / "OUTPUT"
    archive_dir = tmp_path / "ARCHIVE"
    input_dir.mkdir()
    output_dir.mkdir()
    archive_dir.mkdir()
    (input_dir / "ep01_KO.srt").write_text("source")
    (output_dir / "ep01_EN.srt").write_text("english")
    (output_dir / "ep01_TC.srt").write_text("chinese")
    monkeypatch.setattr("translate.INPUT_DIR", input_dir)
    monkeypatch.setattr("translate.OUTPUT_DIR", output_dir)
    monkeypatch.setattr("translate.ARCHIVE_DIR", archive_dir)

    count = archive_all()

    assert count == 3
    assert list(input_dir.glob("*.srt")) == []
    assert list(output_dir.glob("*.srt")) == []
    archived = list(archive_dir.rglob("*.srt"))
    assert len(archived) == 3


def test_archive_all_returns_zero_when_empty(tmp_path, monkeypatch):
    input_dir = tmp_path / "INPUT"
    output_dir = tmp_path / "OUTPUT"
    archive_dir = tmp_path / "ARCHIVE"
    input_dir.mkdir(); output_dir.mkdir(); archive_dir.mkdir()
    monkeypatch.setattr("translate.INPUT_DIR", input_dir)
    monkeypatch.setattr("translate.OUTPUT_DIR", output_dir)
    monkeypatch.setattr("translate.ARCHIVE_DIR", archive_dir)
    assert archive_all() == 0
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/KMTV-Translate && pytest tests/ -v -k "input_files or output_path or archive"
```

Expected: `ImportError` for the three new functions.

- [ ] **Step 3: Implement the file management functions** — add after the engine in `translate.py`

```python
# ── File management ───────────────────────────────────────────────────────────

def get_input_files() -> list[Path]:
    return sorted(INPUT_DIR.glob("*.srt"))


def output_path(input_path: Path, lang: str) -> Path:
    stem = re.sub(r"_KO$", "", input_path.stem, flags=re.IGNORECASE)
    return OUTPUT_DIR / f"{stem}_{lang}.srt"


def archive_all() -> int:
    files = list(INPUT_DIR.glob("*.srt")) + list(OUTPUT_DIR.glob("*.srt"))
    if not files:
        return 0
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    dest = ARCHIVE_DIR / stamp
    dest.mkdir(parents=True, exist_ok=True)
    for f in files:
        shutil.move(str(f), dest / f.name)
    return len(files)
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/KMTV-Translate && git add translate.py tests/test_translate.py
git commit -m "feat: file management — input discovery, output naming, archive"
```

---

## Task 6: CLI menus and main loop

**Files:**
- Modify: `translate.py` — add `ask_settings`, `_save_and_report`, `run_translation`, `main`

These functions drive `questionary` interactively and are not unit-tested. They are verified in Task 7 via smoke test.

- [ ] **Step 1: Add `ask_settings`** — add after file management functions in `translate.py`

```python
# ── CLI ───────────────────────────────────────────────────────────────────────

def ask_settings() -> tuple[list[str], str, str]:
    langs = questionary.checkbox(
        "Language(s)?",
        choices=[
            questionary.Choice(LANG_LABELS["EN"], value="EN", checked=True),
            questionary.Choice(LANG_LABELS["TC"], value="TC", checked=True),
            questionary.Choice(LANG_LABELS["TW"], value="TW"),
        ],
    ).ask()

    if not langs:
        print("  No language selected — cancelling.")
        return [], "", ""

    model = questionary.select(
        "Model?",
        choices=[
            questionary.Choice(MODEL_LABELS["gpt-4o"], value="gpt-4o"),
            questionary.Choice(MODEL_LABELS["gpt-4o-mini"], value="gpt-4o-mini"),
        ],
    ).ask()

    notes = (questionary.text(
        "Translator notes? (optional — press Enter to skip)"
    ).ask() or "").strip()[:MAX_NOTES_LENGTH]

    return langs, model, notes
```

- [ ] **Step 2: Add `_save_and_report` and `run_translation`**

```python
def _save_and_report(input_path: Path, results: dict[str, tuple[str, int]]) -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    print("\n  Done:")
    for lang, (content, block_count) in results.items():
        out = output_path(input_path, lang)
        out.write_text(content, encoding="utf-8")
        print(f"    OUTPUT/{out.name}  {block_count} blocks  ✓")


def run_translation(
    client: OpenAI,
    files: list[Path],
    batch_scope: str | None,
) -> None:
    if batch_scope == "per":
        for input_path in files:
            print(f"\n─── {input_path.name} ───────────────────────────────────")
            langs, model, notes = ask_settings()
            if not langs:
                continue
            results = translate_file(client, input_path, langs, model, notes)
            _save_and_report(input_path, results)
    else:
        langs, model, notes = ask_settings()
        if not langs:
            return
        for input_path in files:
            print(f"\n─── {input_path.name} ───────────────────────────────────")
            results = translate_file(client, input_path, langs, model, notes)
            _save_and_report(input_path, results)
```

- [ ] **Step 3: Add `main`**

```python
def main() -> None:
    load_dotenv(BASE / ".env")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set. Add it to .env and try again.")
        return

    INPUT_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    ARCHIVE_DIR.mkdir(exist_ok=True)

    client = OpenAI(api_key=api_key)

    while True:
        print("\n─── KMTV Subtitle Translator ────────────────────────")
        action = questionary.select(
            "What do you want to do?",
            choices=[
                "Translate",
                "Clean up  (move Input + Output → Archive)",
                "Exit",
            ],
        ).ask()

        if action is None or action == "Exit":
            break

        if "Clean up" in action:
            confirm = questionary.confirm(
                "Move all files from INPUT + OUTPUT to Archive?", default=False
            ).ask()
            if confirm:
                n = archive_all()
                if n:
                    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
                    print(f"  Archived → ARCHIVE/{stamp}/  ({n} files)")
                else:
                    print("  Nothing to archive — INPUT and OUTPUT are already empty.")
            continue

        # ── Translate ────────────────────────────────────────────────────────
        files = get_input_files()
        if not files:
            print("  No .srt files found in INPUT/. Drop some files and try again.")
            continue

        if len(files) == 1:
            selected = files
            batch_scope = None
        else:
            choice = questionary.select(
                "Which file(s)?",
                choices=["Translate ALL"] + [f.name for f in files],
            ).ask()

            if choice == "Translate ALL":
                selected = files
                scope_answer = questionary.select(
                    "Apply settings to…",
                    choices=[
                        questionary.Choice(
                            "All files  (ask once, use for every file)", value="all"
                        ),
                        questionary.Choice(
                            "Per file   (ask settings before each file)", value="per"
                        ),
                    ],
                ).ask()
                batch_scope = scope_answer
            else:
                selected = [INPUT_DIR / choice]
                batch_scope = None

        run_translation(client, selected, batch_scope)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the full test suite — verify nothing is broken**

```bash
cd ~/KMTV-Translate && pytest tests/ -v
```

Expected: all tests pass (adding `main` doesn't break anything because it's only called via `if __name__ == "__main__"`).

- [ ] **Step 5: Commit**

```bash
cd ~/KMTV-Translate && git add translate.py
git commit -m "feat: interactive CLI menus and main loop"
```

---

## Task 7: End-to-end smoke test

**Goal:** Verify the tool runs correctly from double-click to output file on disk with a real SRT file and a real API call.

- [ ] **Step 1: Create a small test SRT in INPUT/**

Create `~/KMTV-Translate/INPUT/smoke_KO.srt` with this content (10 blocks — one batch):

```
1
00:00:01,000 --> 00:00:03,000
안녕하세요, 저는 민준이에요.

2
00:00:04,000 --> 00:00:06,000
오늘 날씨가 정말 좋네요.

3
00:00:07,000 --> 00:00:09,000
언니, 밥 먹었어요?

4
00:00:10,000 --> 00:00:12,000
아직요. 같이 먹을래요?

5
00:00:13,000 --> 00:00:15,000
오빠가 전화했어요.

6
00:00:16,000 --> 00:00:18,000
뭐라고 했어요?

7
00:00:19,000 --> 00:00:21,000
내일 만나자고 했어요.

8
00:00:22,000 --> 00:00:24,000
알겠어요, 고마워요.

9
00:00:25,000 --> 00:00:27,000
선배님, 잠깐 시간 있으세요?

10
00:00:28,000 --> 00:00:30,000
네, 무슨 일이에요?
```

- [ ] **Step 2: Verify `.env` has a valid API key**

```bash
grep OPENAI_API_KEY ~/KMTV-Translate/.env
```

Expected: shows a key starting with `sk-`.

- [ ] **Step 3: Run the tool from Terminal**

```bash
cd ~/KMTV-Translate && python3 translate.py
```

Navigate the menus:
- Action → **Translate**
- File → `smoke_KO.srt` (auto-selected, only one file)
- Language → select **English (EN)** only (faster for a smoke test)
- Model → **GPT-4o mini** (cheaper for a test)
- Notes → press Enter (skip)

- [ ] **Step 4: Verify output**

```bash
ls ~/KMTV-Translate/OUTPUT/
cat ~/KMTV-Translate/OUTPUT/smoke_EN.srt
```

Expected:
- `smoke_EN.srt` exists in OUTPUT/
- File contains 10 SRT blocks numbered 1–10
- Text is in English with honorifics handled (언니→"unnie" or equivalent, 오빠→"oppa", 선배님→"sunbae")
- Timestamps are unchanged

- [ ] **Step 5: Test the Clean up flow**

Run the tool again, choose **Clean up**, confirm with `y`.

```bash
ls ~/KMTV-Translate/INPUT/
ls ~/KMTV-Translate/OUTPUT/
ls ~/KMTV-Translate/ARCHIVE/
```

Expected:
- `INPUT/` and `OUTPUT/` are empty
- `ARCHIVE/` contains one timestamped folder with both `smoke_KO.srt` and `smoke_EN.srt`

- [ ] **Step 6: Test the double-click launcher**

Double-click `translate.command` in Finder. A Terminal window should open and show the main menu.

- [ ] **Step 7: Final commit**

```bash
cd ~/KMTV-Translate && git add .
git commit -m "feat: KMTV local subtitle translator — complete"
```

---

## Setup Summary (for the user)

After the plan is executed, the one-time setup a new machine needs:

```bash
pip install openai questionary python-dotenv
# Add OPENAI_API_KEY to ~/KMTV-Translate/.env
chmod +x ~/KMTV-Translate/translate.command
```

Then: drop `.srt` files in `INPUT/`, double-click `translate.command`, done.
