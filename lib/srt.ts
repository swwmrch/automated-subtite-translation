export interface SrtBlock {
  index: number;
  timestamp: string;
  text: string;
}

export function parseSrt(content: string): SrtBlock[] {
  const normalized = content
    .replace(/^﻿/, "") // strip UTF-8 BOM
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rawBlocks = normalized.trim().split(/\n{2,}/);
  const result: SrtBlock[] = [];

  for (const block of rawBlocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0].trim(), 10);
    const timestamp = lines[1].trim();
    const text = lines.slice(2).join("\n").trim();

    if (isNaN(index) || !timestamp.includes("-->") || !text) continue;
    result.push({ index, timestamp, text });
  }

  return result;
}

export function blocksToRawStrings(blocks: SrtBlock[]): string[] {
  return blocks.map((b) => `${b.index}\n${b.timestamp}\n${b.text}`);
}

// Strip LLM code fences and normalize smart quotes introduced by the model.
export function cleanRawResponse(raw: string): string {
  let clean = raw.replace(/^```[^\n]*$/gm, "");
  clean = clean.replace(/‘/g, "'").replace(/’/g, "'");
  clean = clean.replace(/“/g, '"').replace(/”/g, '"');
  return clean;
}

// Parse LLM response into clean SRT block strings.
export function parseTranslatedBlocks(raw: string): string[] {
  return cleanRawResponse(raw)
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && b.includes("-->"));
}

// Re-number blocks and strip bare integer artifacts that leak from LLM output.
export function fixSrtNumbering(blocks: string[]): string[] {
  const fixed: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const num = i + 1;
    const lines = block.split("\n");
    if (!lines.length) continue;

    lines[0] = String(num);

    if (lines.length >= 3 && lines[1].includes("-->")) {
      const ts = lines[1].trim();
      const textLines = lines.slice(2).filter((ln) => !/^\d+$/.test(ln.trim()));
      if (textLines.length) fixed.push(`${num}\n${ts}\n${textLines.join("\n")}`);
    } else if (lines.length >= 2 && lines.some((ln) => ln.includes("-->"))) {
      const ts = lines.find((ln) => ln.includes("-->"))?.trim() ?? "";
      const textLines = lines.filter(
        (ln) => !ln.includes("-->") && !/^\d+$/.test(ln.trim())
      );
      if (ts && textLines.length) fixed.push(`${num}\n${ts}\n${textLines.join("\n")}`);
    }
  }

  return fixed;
}

export interface SrtWarning {
  type: string;
  message: string;
}

// Post-translation validation — returns warnings for known LLM output errors.
export function validateSrt(content: string, expectedBlocks: number, lang = ""): SrtWarning[] {
  const warnings: SrtWarning[] = [];
  const tsRe = /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/;
  const smartQuoteRe = /[''""]/u;
  const koreanRe = /[가-힣ᄀ-ᇿ㄰-㆏]/u;

  const blocks = content
    .trim()
    .split(/\n\n+/)
    .filter((b) => b.trim());

  if (blocks.length !== expectedBlocks) {
    warnings.push({
      type: "block_count",
      message: `block count mismatch: expected ${expectedBlocks}, got ${blocks.length}`,
    });
  }

  const fenceLines: string[] = [];
  const leakedNumbers: string[] = [];
  const smartQuotes: string[] = [];
  const tsTrailing: string[] = [];
  const koreanLines: string[] = [];

  for (const b of blocks) {
    const lines = b.split("\n");
    if (!lines.length) continue;
    const idxStr = lines[0];

    lines.forEach((ln, j) => {
      if (ln.includes("`"))
        fenceLines.push(`#${idxStr} line ${j + 1}`);
      if (j >= 2 && /^\d+$/.test(ln.trim()))
        leakedNumbers.push(`#${idxStr} line ${j + 1}`);
      if (smartQuoteRe.test(ln))
        smartQuotes.push(`#${idxStr} line ${j + 1}`);
      if (j >= 2 && lang !== "KO" && koreanRe.test(ln))
        koreanLines.push(`#${idxStr}`);
    });

    if (lines.length >= 2 && tsRe.test(lines[1]) && lines[1] !== lines[1].trimEnd()) {
      tsTrailing.push(`#${idxStr}`);
    }
  }

  if (fenceLines.length)
    warnings.push({ type: "fence", message: `code fence artifacts (${fenceLines.length}): ${fenceLines.slice(0, 3).join(", ")}` });
  if (leakedNumbers.length)
    warnings.push({ type: "leaked_numbers", message: `bare numbers in text (${leakedNumbers.length}): ${leakedNumbers.slice(0, 3).join(", ")}` });
  if (smartQuotes.length)
    warnings.push({ type: "smart_quotes", message: `smart quotes (${smartQuotes.length}): ${smartQuotes.slice(0, 3).join(", ")}` });
  if (tsTrailing.length)
    warnings.push({ type: "ts_trailing", message: `timestamp trailing spaces (${tsTrailing.length}): ${tsTrailing.slice(0, 3).join(", ")}` });
  if (koreanLines.length)
    warnings.push({ type: "untranslated", message: `untranslated Korean text (${koreanLines.length} blocks — batch fallback): ${koreanLines.slice(0, 5).join(", ")}` });

  return warnings;
}
