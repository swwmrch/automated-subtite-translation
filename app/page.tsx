"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type Lang = "EN" | "TC" | "TW";
type GptModel = "gpt-4o" | "gpt-4o-mini";
type Status = "idle" | "translating" | "done" | "error";

interface TranslateResult {
  lang: Lang;
  content: string;
  blocks: number;
  warnings: string[];
}

export default function HomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [langs, setLangs] = useState<Lang[]>(["EN"]);
  const [model, setModel] = useState<GptModel>("gpt-4o");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState({ batch: 0, of: 0, lang: "" });
  const [results, setResults] = useState<TranslateResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [notes, setNotes] = useState("");

  function toggleLang(lang: Lang) {
    setLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".srt")) setFile(dropped);
  }, []);

  async function runTranslation(lang: Lang): Promise<TranslateResult> {
    const formData = new FormData();
    formData.append("file", file!);
    formData.append("lang", lang);
    formData.append("model", model);
    if (notes.trim()) formData.append("notes", notes.trim());

    const res = await fetch("/api/translate", { method: "POST", body: formData });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let event: any;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (event.type === "progress") {
          setProgress({ batch: event.batch, of: event.of, lang });
        } else if (event.type === "done") {
          return { lang, content: event.content, blocks: event.blocks, warnings: event.warnings ?? [] };
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }

    throw new Error("Stream ended without a result");
  }

  async function handleTranslate() {
    if (!file || langs.length === 0) return;

    setStatus("translating");
    setResults([]);
    setErrorMsg("");

    try {
      const collected: TranslateResult[] = [];
      for (const lang of langs) {
        const result = await runTranslation(lang);
        collected.push(result);
        setResults([...collected]);
      }
      setStatus("done");
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  }

  function handleClear() {
    setFile(null);
    setLangs(["EN"]);
    setStatus("idle");
    setResults([]);
    setErrorMsg("");
    setProgress({ batch: 0, of: 0, lang: "" });
    setNotes("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadResult(result: TranslateResult) {
    const baseName = file!.name.replace(/_KO\.srt$/i, "").replace(/\.srt$/i, "");
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}_${result.lang}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isTranslating = status === "translating";
  const progressPct = progress.of > 0 ? Math.round((progress.batch / progress.of) * 100) : 0;

  const langLabel = (lang: Lang) =>
    lang === "EN" ? "English" : lang === "TC" ? "Traditional Chinese" : "Taiwanese Hokkien (台語)";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-blue-400 text-white text-xs font-bold px-2 py-0.5 rounded">
              KMTV
            </span>
            <span className="text-sm font-medium text-gray-700">Subtitle Translator</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* 3-column layout */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 md:px-6 md:py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* LEFT — Input */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Source</p>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`
                flex-1 border-2 border-dashed rounded-xl cursor-pointer transition-colors
                flex flex-col items-center justify-center min-h-48 md:min-h-72 p-6 text-center
                ${dragging
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-white"}
              `}
            >
              {file ? (
                <div className="space-y-2">
                  <div className="text-4xl">📄</div>
                  <p className="text-sm font-medium text-gray-800 break-all leading-snug">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                  <p className="text-xs text-gray-300 mt-2">Click to replace</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-5xl text-gray-200">↑</p>
                  <p className="text-sm text-gray-500">
                    Drop your <span className="font-semibold text-gray-700">KO.srt</span> here
                  </p>
                  <p className="text-xs text-gray-400">or click to browse</p>
                  <p className="text-xs text-gray-300 mt-3">Max 500 KB · .srt only</p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".srt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />
          </div>

          {/* CENTER — Settings */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Settings</p>

            {/* Language */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Translate to</label>
              <div className="flex flex-col gap-2">
                {(["EN", "TC", "TW"] as Lang[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => toggleLang(lang)}
                    disabled={isTranslating}
                    className={`
                      w-full px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left
                      disabled:cursor-not-allowed
                      ${langs.includes(lang)
                        ? "bg-blue-50 border-blue-300 text-blue-600"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"}
                    `}
                  >
                    <span className="flex items-center gap-2">
                      {langLabel(lang)}
                      {lang === "TW" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 leading-none">
                          beta
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Model</label>
              <div className="flex flex-col gap-2">
                {(["gpt-4o", "gpt-4o-mini"] as GptModel[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setModel(m)}
                    disabled={isTranslating}
                    className={`
                      w-full px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left
                      disabled:cursor-not-allowed
                      ${model === m
                        ? "bg-blue-50 border-blue-300 text-blue-600"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"}
                    `}
                  >
                    {m === "gpt-4o" ? "GPT-4o (Recommended)" : "GPT-4o mini"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {model === "gpt-4o"
                  ? "Best quality. Slower and uses more credits."
                  : "Faster and cheaper. Lower translation quality."}
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Translator notes{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isTranslating}
                rows={3}
                placeholder="e.g. Romantic K-drama, formal speech between colleagues"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="text-xs text-gray-400">Describe the genre or tone so the translator can adapt.</p>
            </div>

            {/* Push buttons to bottom */}
            <div className="flex-1" />

            {/* Translate */}
            <button
              onClick={handleTranslate}
              disabled={!file || langs.length === 0 || isTranslating}
              className="w-full bg-gray-900 hover:bg-gray-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {isTranslating ? "Translating…" : "Translate"}
            </button>

            {/* Clear */}
            {(file !== null || results.length > 0 || status === "error") && !isTranslating && (
              <button
                onClick={handleClear}
                className="w-full border border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600 font-medium py-2 rounded-xl text-sm transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* RIGHT — Output */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Output</p>

            {/* Empty state */}
            {!isTranslating && results.length === 0 && status !== "error" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <span className="text-gray-300 text-lg">↓</span>
                </div>
                <p className="text-sm text-gray-400">Translated files will appear here</p>
              </div>
            )}

            {/* Progress */}
            {isTranslating && (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {progress.lang ? langLabel(progress.lang as Lang) : langLabel(langs[0])}
                    {" — "}Batch {progress.batch} of {progress.of}
                  </span>
                  <span className="text-gray-400">{progressPct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {status === "error" && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
                {errorMsg}
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  {status === "done" ? "Ready to download" : "Completed so far"}
                </p>
                {results.map((r) => (
                  <div key={r.lang} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{langLabel(r.lang)}</p>
                        <p className="text-xs text-gray-400">{r.blocks} blocks</p>
                      </div>
                      <button
                        onClick={() => downloadResult(r)}
                        className="shrink-0 bg-gray-900 hover:bg-gray-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                      >
                        Download .srt
                      </button>
                    </div>
                    {r.warnings.length > 0 && (
                      <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 space-y-1">
                        {r.warnings.map((w, i) => (
                          <p key={i} className="text-xs text-amber-700 break-words">⚠ {w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
