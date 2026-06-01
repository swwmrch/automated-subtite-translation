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
          return { lang, content: event.content, blocks: event.blocks };
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-blue-400 text-white text-xs font-bold px-2 py-0.5 rounded">
              KMTV ASIA
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

      {/* Main */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10 space-y-6">

        {/* Upload zone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Korean subtitle file
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400 bg-white"}
            `}
          >
            {file ? (
              <div className="space-y-1">
                <div className="text-2xl">📄</div>
                <p className="text-sm font-medium text-gray-800">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                <p className="text-xs text-gray-400 mt-2">Click to replace</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl text-gray-300">↑</p>
                <p className="text-sm text-gray-500">
                  Drop your <span className="font-medium text-gray-700">KO.srt</span> here, or click to browse
                </p>
                <p className="text-xs text-gray-400">Max 500 KB · .srt only</p>
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

        {/* Language selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Translate to
          </label>
          <div className="flex gap-3">
            {(["EN", "TC", "TW"] as Lang[]).map((lang) => (
              <button
                key={lang}
                onClick={() => toggleLang(lang)}
                className={`
                  px-5 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${langs.includes(lang)
                    ? "bg-blue-400 border-blue-400 text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}
                `}
              >
                {lang === "EN" ? "English" : lang === "TC" ? "Traditional Chinese (TW)" : "Taiwanese (台語)"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Select one or both. If both, EN runs first then TC.</p>
        </div>

        {/* Model selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Model
          </label>
          <div className="flex gap-3">
            {(["gpt-4o", "gpt-4o-mini"] as GptModel[]).map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`
                  px-5 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${model === m
                    ? "bg-blue-400 border-blue-400 text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}
                `}
              >
                {m === "gpt-4o" ? "GPT-4o (Recommended)" : "GPT-4o mini"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {model === "gpt-4o"
              ? "Best quality. Slower and uses more credits."
              : "Faster and cheaper. Lower translation quality."}
          </p>
        </div>

        {/* Translate button */}
        <button
          onClick={handleTranslate}
          disabled={!file || langs.length === 0 || isTranslating}
          className="w-full bg-blue-400 hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl text-sm transition-colors"
        >
          {isTranslating ? "Translating…" : "Translate"}
        </button>

        {/* Progress */}
        {isTranslating && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                {progress.lang || langs[0]} — Batch {progress.batch} of {progress.of}
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
            <p className="text-sm font-medium text-gray-700">
              {status === "done" ? "Ready to download" : "Completed so far"}
            </p>
            {results.map((r) => (
              <div
                key={r.lang}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {r.lang === "EN" ? "English" : r.lang === "TC" ? "Traditional Chinese (TW)" : "Taiwanese (台語)"}
                  </p>
                  <p className="text-xs text-gray-400">{r.blocks} subtitle blocks</p>
                </div>
                <button
                  onClick={() => downloadResult(r)}
                  className="bg-gray-900 hover:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Download .srt
                </button>
              </div>
            ))}
          </div>
        )}

        {(file !== null || results.length > 0 || status === "error") && !isTranslating && (
          <button
            onClick={handleClear}
            className="w-full border border-gray-300 hover:border-gray-400 text-gray-500 hover:text-gray-700 font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </main>
    </div>
  );
}
