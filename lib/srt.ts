export interface SrtBlock {
  index: number;
  timestamp: string;
  text: string;
}

export function parseSrt(content: string): SrtBlock[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
