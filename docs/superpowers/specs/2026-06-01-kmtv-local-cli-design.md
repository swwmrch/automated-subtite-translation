# KMTV Local Subtitle Translator — Design Spec
_Date: 2026-06-01_

## Overview

A standalone local CLI tool that translates Korean `.srt` subtitle files into English, Traditional Chinese (Taiwan), and/or Taiwanese Hokkien. Fully interactive — no typing required, all choices via arrow-key menus. Double-clickable on macOS.

---

## Folder Structure

Lives at `~/KMTV-Translate/` (separate from the Next.js repo).

```
~/KMTV-Translate/
├── translate.command      ← macOS double-click launcher
├── translate.py           ← entire tool in one file
├── .env                   ← OPENAI_API_KEY=sk-...
├── INPUT/                 ← drop .srt files here before running
├── OUTPUT/                ← translated .srt files appear here
└── ARCHIVE/
    └── 2026-06-01_14-30/  ← flat folder created on manual cleanup
        ├── episode01_KO.srt
        ├── episode01_EN.srt
        └── episode01_TC.srt
```

**Archive naming:** `YYYY-MM-DD_HH-MM` timestamp of when cleanup was triggered.  
**Archive contents:** flat — `_KO` suffix identifies the original, language codes (`_EN`, `_TC`, `_TW`) identify translations.

---

## Terminal Q&A Flow

All menus use `questionary` — arrow keys to move, space to toggle (multi-select), Enter to confirm. No free-text typing except the optional notes field.

### Main menu

```
─── KMTV Subtitle Translator ────────────────────────────
? What do you want to do?
  > Translate
    Clean up  (move Input + Output → Archive)
    Exit
```

### Translate → file selection

| Condition | Behaviour |
|-----------|-----------|
| 0 files in INPUT | Print error, return to main menu |
| 1 file in INPUT | Skip picker, go straight to settings |
| 2+ files in INPUT | Show picker: "Translate ALL" at top, then individual files |

```
? Which file(s)?
  > Translate ALL
    episode01_KO.srt
    episode02_KO.srt
```

### Settings (same questions for every run, including batch)

```
? Language(s)?  (space to select, enter to confirm)
  [x] English (EN)
  [x] Traditional Chinese — Taiwan (TC)
  [ ] Taiwanese Hokkien (TW)

? Model?
  > GPT-4o        (best quality)
    GPT-4o mini   (faster, cheaper)

? Translator notes? (optional — press Enter to skip)
```

### Progress

One file at a time. For batch runs, each file is announced before its languages are processed.

```
─── episode01_KO.srt ────────────────────────────────────
  EN  Batch 4 / 7  [████████░░░░░░░░░░░░]
  TC  Waiting...
```

### Done

```
─── Done ────────────────────────────────────────────────
  OUTPUT/episode01_EN.srt   342 blocks  ✓
  OUTPUT/episode01_TC.srt   342 blocks  ✓
```

### Clean up

```
? Move all files from INPUT + OUTPUT to Archive? (y/N)
  Archived → ARCHIVE/2026-06-01_14-30/  (5 files)
```

---

## Translation Engine

Ported from `app/api/translate/route.ts` (TypeScript → Python). The Python pipeline (`subtitle_pipeline2.py`) provides the retry/batch scaffolding; the TypeScript version provides the superior prompts.

### System prompt (`build_system_prompt(lang)`)

Base: Korean entertainment specialist — K-dramas, variety shows, honorifics, onomatopoeia.  
- `TC`: Taiwan Mandarin vocabulary (捷運 not 地鐵, etc.), avoid Mainland expressions.  
- `TW`: Taiwanese Hokkien in 漢字, following 教育部台灣閩南語推薦用字.  
- `EN`: romanised names, natural English equivalents for onomatopoeia.

### User prompt (`build_prompt(blocks, lang, notes)`)

Per-language guidelines:
- Honorific mapping: 언니→姊姊/阿姊/"unnie", 오빠→哥哥/阿兄/"oppa", etc.
- Preserve line count per block (a 2-line subtitle stays 2 lines).
- Optional `notes` appended as "Context from user: …" (max 300 chars).
- Output rules: exact count, no commentary, SRT structure only.

### Batch parameters

| Parameter | Value |
|-----------|-------|
| Batch size | 10 blocks |
| Max retries | 3 |
| Sleep between batches | 1.5 s |
| Sleep between retries | 5 s |
| Fallback | Keep Korean original for failed blocks |

### SRT utilities

- `parse_srt(content)` — normalize line endings, split on blank lines, validate index + timestamp + text.
- `blocks_to_raw_strings(blocks)` — `"{index}\n{timestamp}\n{text}"` per block.
- `fix_srt_numbering(blocks)` — re-index from 1 after translation (from `subtitle_pipeline2.py`).
- `parse_translated_blocks(raw)` — split on `\n\n`, keep only blocks containing `-->`.

### Output filename

`{stem}_{LANG}.srt` where stem strips a trailing `_KO` if present.  
Example: `episode01_KO.srt` → `episode01_EN.srt`, `episode01_TC.srt`.

---

## Dependencies

```
openai
questionary
python-dotenv
```

Install once: `pip install openai questionary python-dotenv`

---

## Setup Steps (for user)

1. Create `~/KMTV-Translate/` with the structure above.
2. Add `OPENAI_API_KEY=sk-...` to `.env`.
3. `pip install openai questionary python-dotenv`
4. `chmod +x ~/KMTV-Translate/translate.command` (once in Terminal).
5. Double-click `translate.command` to launch.

---

## Out of Scope

- Transcription (Whisper) — handled by the separate `subtitle_pipeline2.py`.
- Web UI / login / session management — stays in the Next.js app.
- Rate-limit tracking across multiple sessions.
- Any file format other than `.srt`.
