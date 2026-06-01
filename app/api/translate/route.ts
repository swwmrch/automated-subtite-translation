import { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { parseSrt, blocksToRawStrings } from "@/lib/srt";
import OpenAI from "openai";

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_SLEEP_MS = 5000;
const BATCH_SLEEP_MS = 1500;
const MAX_FILE_SIZE = 512 * 1024; // 500 KB
const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
type GptModel = (typeof ALLOWED_MODELS)[number];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(blocks: string[], lang: "EN" | "TC" | "TW"): string {
  const count = blocks.length;
  const body = blocks.join("\n\n");

  if (lang === "TC") {
    return (
      `Translate ALL ${count} Korean subtitle blocks below into Traditional Chinese used in Taiwan. ` +
      `Use Taiwanese vocabulary and expressions. Avoid Mainland Chinese wording. ` +
      `Keep subtitle timing unchanged. Natural conversational Taiwanese Mandarin. ` +
      `Preserve the exact SRT block structure (number, timestamp, text). ` +
      `You MUST return exactly ${count} blocks — one for every input block. ` +
      `Return ONLY the translated SRT blocks — no explanations, no extra text.\n\n---\n\n${body}`
    );
  }
  if (lang === "TW") {
    return (
      `Translate ALL ${count} Korean subtitle blocks below into Taiwanese Hokkien (台語/Taigi). ` +
      `Write the Taiwanese using Chinese characters (漢字) as naturally used in written Taiwanese. ` +
      `Use authentic Taiwanese Hokkien vocabulary and phrasing — not Mandarin translated into Taiwanese. ` +
      `Keep subtitle timing unchanged. ` +
      `Preserve the exact SRT block structure (number, timestamp, text). ` +
      `You MUST return exactly ${count} blocks — one for every input block. ` +
      `Return ONLY the translated SRT blocks — no explanations, no extra text.\n\n---\n\n${body}`
    );
  }
  return (
    `Translate ALL ${count} Korean subtitle blocks below into English. ` +
    `Use natural conversational English. Keep subtitle timing unchanged. ` +
    `Preserve the exact SRT block structure (number, timestamp, text). ` +
    `You MUST return exactly ${count} blocks — one for every input block. ` +
    `Return ONLY the translated SRT blocks — no explanations, no extra text.\n\n---\n\n${body}`
  );
}

function parseBlocks(raw: string): string[] {
  return raw
    .trim()
    .split(/\n{2,}/)
    .filter((b) => b.trim() && b.includes("-->"));
}

async function translateBatch(
  client: OpenAI,
  batch: string[],
  lang: "EN" | "TC" | "TW",
  model: GptModel
): Promise<string[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: buildPrompt(batch, lang) }],
        temperature: 0.2,
      });
      const translated = parseBlocks(res.choices[0].message.content?.trim() ?? "");
      if (translated.length === batch.length) return translated;
    } catch {
      // fall through to retry
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_SLEEP_MS);
  }
  return batch; // fallback: return Korean unchanged
}

export async function POST(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.isLoggedIn) {
    return new Response("Unauthorized", { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const lang = formData.get("lang") as string | null;
  const modelParam = (formData.get("model") as string | null) ?? "gpt-4o";

  if (!file) return new Response("No file provided", { status: 400 });
  if (!lang || !["EN", "TC", "TW"].includes(lang))
    return new Response("lang must be EN, TC, or TW", { status: 400 });
  if (!ALLOWED_MODELS.includes(modelParam as GptModel))
    return new Response("Invalid model", { status: 400 });
  const model = modelParam as GptModel;
  if (!file.name.toLowerCase().endsWith(".srt"))
    return new Response("Only .srt files accepted", { status: 400 });
  if (file.size > MAX_FILE_SIZE)
    return new Response("File too large (max 500 KB)", { status: 413 });

  const content = await file.text();
  const blocks = parseSrt(content);

  if (blocks.length === 0)
    return new Response("No valid SRT blocks found in file", { status: 422 });

  const rawBlocks = blocksToRawStrings(blocks);
  const totalBatches = Math.ceil(rawBlocks.length / BATCH_SIZE);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      send({ type: "start", total: blocks.length, batches: totalBatches });

      try {
        const allTranslated: string[] = [];

        for (let i = 0; i < rawBlocks.length; i += BATCH_SIZE) {
          const batch = rawBlocks.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          send({ type: "progress", batch: batchNum, of: totalBatches });

          const translated = await translateBatch(openaiClient, batch, lang as "EN" | "TC" | "TW", model);
          allTranslated.push(...translated);

          if (i + BATCH_SIZE < rawBlocks.length) await sleep(BATCH_SLEEP_MS);
        }

        const srtContent =
          allTranslated
            .map((block, idx) => {
              const lines = block.split("\n");
              lines[0] = String(idx + 1);
              return lines.join("\n");
            })
            .join("\n\n") + "\n";

        send({ type: "done", content: srtContent, blocks: allTranslated.length });
      } catch {
        send({ type: "error", message: "Translation failed. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
