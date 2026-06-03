import { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { parseSrt, blocksToRawStrings, parseTranslatedBlocks, fixSrtNumbering, validateSrt } from "@/lib/srt";
import OpenAI from "openai";

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_SLEEP_MS = 5000;
const BATCH_SLEEP_MS = 1500;
const MAX_FILE_SIZE = 512 * 1024; // 500 KB
const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const enc = new TextEncoder();
type GptModel = (typeof ALLOWED_MODELS)[number];

const MAX_NOTES_LENGTH = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(lang: "EN" | "TC" | "TW"): string {
  const base =
    "You are a professional Korean subtitle translator specializing in Korean entertainment — " +
    "K-dramas, variety shows, and TV programmes. " +
    "You preserve the natural emotional tone, conversational rhythm, and cultural nuance of every line. " +
    "You are expert at Korean honorifics, onomatopoeia, and subtitle formatting.";

  if (lang === "TC") {
    return (
      base +
      " You translate into Traditional Chinese as used in Taiwan (台灣繁體中文/台灣華語). " +
      "You use Taiwan Mandarin vocabulary naturally and avoid all Mainland Chinese expressions."
    );
  }
  if (lang === "TW") {
    return (
      base +
      " You translate into authentic Taiwanese Hokkien (台語/臺語) written in Chinese characters (漢字), " +
      "following the character standards of Taiwan's Ministry of Education (教育部台灣閩南語推薦用字)."
    );
  }
  return base;
}

function outputRules(count: number, contextLine: string, body: string): string {
  return (
    `\nOutput format:\n` +
    `- Exact SRT structure: index number → timestamp → translated text\n` +
    `- Return exactly ${count} blocks — no merging, no splitting\n` +
    `- Return ONLY the SRT blocks — no commentary, no extra text\n` +
    `- Do NOT wrap output in markdown code blocks (no \`\`\` fences)\n` +
    `- Use straight apostrophes (') not curly/smart apostrophes (’)` +
    `${contextLine}\n\n---\n\n${body}`
  );
}

function buildPrompt(blocks: string[], lang: "EN" | "TC" | "TW", notes: string): string {
  const count = blocks.length;
  const body = blocks.join("\n\n");
  const contextLine = notes ? `\nContext from user: ${notes}` : "";

  if (lang === "TC") {
    return (
      `Translate the ${count} Korean SRT subtitle blocks below into Traditional Chinese (台灣華語/繁體中文).\n\n` +
      `Guidelines:\n` +
      `- Use Taiwan Mandarin vocabulary: 捷運 not 地鐵, 計程車 not 出租車, 機車 not 摩托車\n` +
      `- Avoid Simplified Chinese characters and Mainland Chinese expressions\n` +
      `- Render Korean honorifics naturally: 언니→姊姊, 오빠→哥哥/歐巴, 선배→學長/學姐, 아저씨→大叔/叔叔\n` +
      `- Transliterate Korean names using Taiwan phonetic conventions\n` +
      `- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n` +
      `- Keep subtitles concise and screen-readable` +
      outputRules(count, contextLine, body)
    );
  }

  if (lang === "TW") {
    return (
      `Translate the ${count} Korean SRT subtitle blocks below into Taiwanese Hokkien (台語/臺語).\n\n` +
      `Guidelines:\n` +
      `- Write in Chinese characters (漢字) following 教育部台灣閩南語推薦用字\n` +
      `- Use authentic Taiwanese Hokkien — not Mandarin words pronounced in Taiwanese\n` +
      `- For concepts without a direct Hokkien equivalent, choose the closest natural Hokkien expression\n` +
      `- Render Korean honorifics in Hokkien: 언니→阿姊, 오빠→阿兄, 선배→學長/前輩\n` +
      `- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n` +
      `- Keep subtitles concise and screen-readable` +
      outputRules(count, contextLine, body)
    );
  }

  return (
    `Translate the ${count} Korean SRT subtitle blocks below into natural English.\n\n` +
    `Guidelines:\n` +
    `- Render Korean honorifics naturally: 언니→"unnie", 오빠→"oppa", 선배→"sunbae", 아저씨→"mister" (adapt to context)\n` +
    `- Keep Korean names romanized (e.g. 민준→Min-jun, 지수→Ji-su)\n` +
    `- Convert Korean onomatopoeia to natural English equivalents (ㅋㅋ→laughter, ㅠㅠ→sadness)\n` +
    `- Preserve the number of text lines per block — a 2-line subtitle must stay 2 lines\n` +
    `- Keep subtitles concise and screen-readable` +
    outputRules(count, contextLine, body)
  );
}

async function translateBatch(
  client: OpenAI,
  batch: string[],
  lang: "EN" | "TC" | "TW",
  model: GptModel,
  notes: string
): Promise<string[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(lang) },
          { role: "user", content: buildPrompt(batch, lang, notes) },
        ],
        temperature: 0.2,
      });
      const translated = parseTranslatedBlocks(res.choices[0].message.content?.trim() ?? "");
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
  const notes = ((formData.get("notes") as string | null)?.trim() ?? "").slice(0, MAX_NOTES_LENGTH);

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
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      send({ type: "start", total: blocks.length, batches: totalBatches });

      try {
        const allTranslated: string[] = [];

        for (let i = 0; i < rawBlocks.length; i += BATCH_SIZE) {
          const batch = rawBlocks.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          send({ type: "progress", batch: batchNum, of: totalBatches });

          const translated = await translateBatch(
            openaiClient,
            batch,
            lang as "EN" | "TC" | "TW",
            model,
            notes
          );
          allTranslated.push(...translated);

          if (i + BATCH_SIZE < rawBlocks.length) await sleep(BATCH_SLEEP_MS);
        }

        const fixed = fixSrtNumbering(allTranslated);
        const srtContent = fixed.join("\n\n") + "\n";
        const validationWarnings = validateSrt(srtContent, fixed.length, lang);

        send({
          type: "done",
          content: srtContent,
          blocks: fixed.length,
          warnings: validationWarnings.map((w) => w.message),
        });
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
