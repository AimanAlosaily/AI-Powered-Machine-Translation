"use client";

import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  FileText,
  KeyRound,
  Languages,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getFileExtension,
  getFullTranslation,
  getSafetyIdentifier,
  MAX_FILE_SIZE,
  translateFile,
  TranslationResult,
  validateFile,
} from "./translation";

const LANGUAGES = [
  ["Arabic", "ar"],
  ["English", "en"],
  ["French", "fr"],
  ["Spanish", "es"],
  ["German", "de"],
  ["Italian", "it"],
  ["Portuguese", "pt"],
  ["Brazilian Portuguese", "pt-BR"],
  ["Chinese (Simplified)", "zh-CN"],
  ["Chinese (Traditional)", "zh-TW"],
  ["Japanese", "ja"],
  ["Korean", "ko"],
  ["Hindi", "hi"],
  ["Urdu", "ur"],
  ["Turkish", "tr"],
  ["Russian", "ru"],
  ["Ukrainian", "uk"],
  ["Dutch", "nl"],
  ["Polish", "pl"],
  ["Swedish", "sv"],
  ["Norwegian", "no"],
  ["Danish", "da"],
  ["Finnish", "fi"],
  ["Greek", "el"],
  ["Hebrew", "he"],
  ["Persian", "fa"],
  ["Indonesian", "id"],
  ["Malay", "ms"],
  ["Thai", "th"],
  ["Vietnamese", "vi"],
  ["Swahili", "sw"],
] as const;

const RTL_CODES = new Set(["ar", "fa", "he", "ur"]);
const ACCEPTED_FILES =
  ".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.webp";

type Phase = "idle" | "reading" | "translating" | "done" | "error";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeFilename(name: string) {
  return (
    name
      .replace(/\.[^/.]+$/, "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .trim() || "translation"
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function TranslatorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("Arabic");
  const [audience, setAudience] = useState("General");
  const [tone, setTone] = useState("Match the original");
  const [context, setContext] = useState("");
  const [glossary, setGlossary] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const targetCode =
    LANGUAGES.find(([name]) => name === targetLanguage)?.[1] ?? "en";
  const isRtl = RTL_CODES.has(targetCode.split("-")[0]);
  const isWorking = phase === "reading" || phase === "translating";

  const progress = phase === "reading" ? 32 : phase === "translating" ? 72 : 0;
  const translationText = useMemo(
    () => (result ? getFullTranslation(result) : ""),
    [result],
  );

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    try {
      validateFile(nextFile);
      setFile(nextFile);
      setError("");
      setResult(null);
      setPhase("idle");
    } catch (fileError) {
      setFile(null);
      setError(
        fileError instanceof Error ? fileError.message : "Invalid file.",
      );
      setPhase("error");
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const handleDropzoneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const handleTranslate = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Choose a document or image first.");
      setPhase("error");
      return;
    }
    if (!apiKey.trim()) {
      setError("Enter your OpenAI API key to start translating.");
      setPhase("error");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setResult(null);
    setPhase("reading");

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setPhase("translating");
      const nextResult = await translateFile({
        file,
        apiKey,
        options: { targetLanguage, audience, tone, context, glossary },
        safetyIdentifier: getSafetyIdentifier(),
        signal: controller.signal,
      });
      setResult(nextResult);
      setPhase("done");
    } catch (translationError) {
      if (translationError instanceof DOMException && translationError.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setError(
        translationError instanceof Error
          ? translationError.message
          : "Translation failed. Please try again.",
      );
      setPhase("error");
    } finally {
      controllerRef.current = null;
    }
  };

  const cancelTranslation = () => {
    controllerRef.current?.abort();
    setPhase("idle");
  };

  const reset = () => {
    controllerRef.current?.abort();
    setFile(null);
    setResult(null);
    setError("");
    setPhase("idle");
    setCopied(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const copyTranslation = async () => {
    await navigator.clipboard.writeText(translationText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadText = () => {
    if (!file || !result) return;
    const blob = new Blob([translationText], {
      type: "text/plain;charset=utf-8",
    });
    downloadBlob(
      blob,
      `${safeFilename(file.name)}-${targetCode}-translated.txt`,
    );
  };

  const downloadDocx = async () => {
    if (!file || !result) return;

    const {
      AlignmentType,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      TextRun,
    } = await import("docx");

    const children = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: isRtl,
        children: [new TextRun({ text: result.title, bold: true })],
      }),
      ...result.sections.map((section) => {
        const heading =
          section.kind === "title"
            ? HeadingLevel.HEADING_1
            : section.kind === "heading"
              ? HeadingLevel.HEADING_2
              : undefined;
        return new Paragraph({
          heading,
          alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          bidirectional: isRtl,
          spacing: { after: 180 },
          children: [
            new TextRun({
              text: section.content,
              bold: section.kind === "title" || section.kind === "heading",
            }),
          ],
        });
      }),
    ];

    const document = new Document({
      sections: [{ properties: {}, children }],
      creator: "Verta",
      title: result.title,
      description: `Translated into ${result.targetLanguage} with Verta`,
    });

    const blob = await Packer.toBlob(document);
    downloadBlob(
      blob,
      `${safeFilename(file.name)}-${targetCode}-translated.docx`,
    );
  };

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Verta home">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span>VERTA</span>
        </a>
        <div className="nav-center" aria-label="Product attributes">
          <span>Context-aware</span>
          <span>30+ languages</span>
          <span>Local-first</span>
        </div>
        <span className="privacy-pill">
          <LockKeyhole size={14} aria-hidden="true" />
          Your key stays in this tab
        </span>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Translation that reads the room
          </div>
          <h1>
            Meaning in.
            <br />
            <span>Meaning out.</span>
          </h1>
          <p className="hero-lede">
            Verta reads the full document before it translates—so the language
            comes back natural, consistent, and right for its audience.
          </p>

          <div className="proof-strip">
            <div>
              <strong>01</strong>
              <span>Reads context</span>
            </div>
            <div>
              <strong>02</strong>
              <span>Resolves terminology</span>
            </div>
            <div>
              <strong>03</strong>
              <span>Checks the result</span>
            </div>
          </div>

          <div className="language-line" aria-label="Example languages">
            <span>مرحباً</span>
            <i aria-hidden="true" />
            <span>Bonjour</span>
            <i aria-hidden="true" />
            <span>こんにちは</span>
            <i aria-hidden="true" />
            <span>Hola</span>
          </div>
        </div>

        <form className="workspace-card" onSubmit={handleTranslate}>
          <div className="card-heading">
            <div>
              <span className="step-label">01 / SOURCE</span>
              <h2>Add your file</h2>
            </div>
            <div className="format-chips" aria-label="Supported formats">
              <span>PDF</span>
              <span>DOCX</span>
              <span>IMG</span>
            </div>
          </div>

          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={ACCEPTED_FILES}
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />

          {file ? (
            <div className="selected-file" data-testid="selected-file">
              <div className="file-icon">
                {file.type.startsWith("image/") ? (
                  <FileImage size={25} aria-hidden="true" />
                ) : (
                  <FileText size={25} aria-hidden="true" />
                )}
              </div>
              <div className="file-meta">
                <strong>{file.name}</strong>
                <span>
                  {getFileExtension(file.name).toUpperCase()} ·{" "}
                  {formatBytes(file.size)}
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={reset}
                aria-label="Remove file"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div
              className={`dropzone ${isDragging ? "is-dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={handleDropzoneKey}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              aria-label="Choose a document or image"
            >
              <span className="upload-glyph">
                <UploadCloud size={26} aria-hidden="true" />
              </span>
              <strong>Drop a document or image</strong>
              <span>or click to browse · up to {MAX_FILE_SIZE / 1024 / 1024} MB</span>
            </div>
          )}

          <div className="form-divider" />

          <div className="card-heading compact">
            <div>
              <span className="step-label">02 / DIRECTION</span>
              <h2>Set the destination</h2>
            </div>
            <Languages size={22} aria-hidden="true" />
          </div>

          <div className="field-grid">
            <label className="field field-wide">
              <span>Target language</span>
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
              >
                {LANGUAGES.map(([name, code]) => (
                  <option key={code} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Audience / domain</span>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option>General</option>
                <option>Business</option>
                <option>Legal</option>
                <option>Medical</option>
                <option>Academic</option>
                <option>Technical</option>
                <option>Marketing</option>
              </select>
            </label>
            <label className="field">
              <span>Tone</span>
              <select
                value={tone}
                onChange={(event) => setTone(event.target.value)}
              >
                <option>Match the original</option>
                <option>Formal and precise</option>
                <option>Natural and conversational</option>
                <option>Clear plain language</option>
              </select>
            </label>
          </div>

          <details className="context-panel">
            <summary>
              <BookOpen size={17} aria-hidden="true" />
              Add context or preferred terms
              <span>Optional</span>
            </summary>
            <div className="context-fields">
              <label className="field">
                <span>Background context</span>
                <textarea
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                  placeholder="Example: This is a Saudi commercial lease for a retail tenant."
                  rows={3}
                />
              </label>
              <label className="field">
                <span>Glossary</span>
                <textarea
                  value={glossary}
                  onChange={(event) => setGlossary(event.target.value)}
                  placeholder={"One term per line, for example:\nconsideration → المقابل"}
                  rows={3}
                />
              </label>
            </div>
          </details>

          <label className="api-field">
            <KeyRound size={17} aria-hidden="true" />
            <span className="sr-only">OpenAI API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="OpenAI API key"
            />
            <span className="api-note">Never saved</span>
          </label>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {isWorking ? (
            <div className="working-panel" aria-live="polite">
              <div className="working-topline">
                <span>
                  <LoaderCircle
                    className="spinner"
                    size={18}
                    aria-hidden="true"
                  />
                  {phase === "reading"
                    ? "Reading the whole file"
                    : "Translating with context"}
                </span>
                <button type="button" onClick={cancelTranslation}>
                  Cancel
                </button>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <p>
                {phase === "reading"
                  ? "Detecting subject, audience, tone, and document structure."
                  : "Resolving terminology and checking for omissions."}
              </p>
            </div>
          ) : (
            <button className="translate-button" type="submit">
              Translate with context
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          )}

          <p className="consent-note">
            Your file is sent directly from this tab to OpenAI for processing.
            Verta does not store your key or upload.
          </p>
        </form>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="section-kicker">
          <span>THE CONTEXTGUARD METHOD</span>
          <span>Not a word swapper</span>
        </div>
        <div className="method-grid">
          <div className="method-intro">
            <h2 id="method-title">A translation is only right in context.</h2>
            <p>
              Verta treats your file as one connected piece of communication.
              It understands first, translates second, and checks last.
            </p>
          </div>
          <article className="method-card">
            <span>01</span>
            <ScanText size={24} aria-hidden="true" />
            <h3>Whole-file reading</h3>
            <p>
              Infers subject, structure, register, and relationships before
              choosing a single translated term.
            </p>
          </article>
          <article className="method-card">
            <span>02</span>
            <Languages size={24} aria-hidden="true" />
            <h3>Audience-aware phrasing</h3>
            <p>
              Writes for your chosen reader and domain while preserving the
              source document&apos;s intent.
            </p>
          </article>
          <article className="method-card">
            <span>03</span>
            <ShieldCheck size={24} aria-hidden="true" />
            <h3>Semantic quality check</h3>
            <p>
              Reviews omissions, numbers, names, terminology, and naturalness
              before returning the result.
            </p>
          </article>
        </div>
      </section>

      {result && file && (
        <section className="result-section" aria-labelledby="result-title">
          <div className="result-header">
            <div>
              <span className="success-label">
                <CheckCircle2 size={16} aria-hidden="true" />
                Translation complete
              </span>
              <h2 id="result-title">{result.title}</h2>
              <p>
                {result.sourceLanguage} <ArrowRight size={14} />{" "}
                {result.targetLanguage} · {result.documentType}
              </p>
            </div>
            <button className="secondary-button" type="button" onClick={reset}>
              <RotateCcw size={16} aria-hidden="true" />
              Translate another
            </button>
          </div>

          <div className="result-layout">
            <article
              className="document-preview"
              dir={isRtl ? "rtl" : "ltr"}
              lang={targetCode}
            >
              {result.sections.map((section, index) => {
                if (section.kind === "title") {
                  return <h2 key={`${section.kind}-${index}`}>{section.content}</h2>;
                }
                if (section.kind === "heading") {
                  return <h3 key={`${section.kind}-${index}`}>{section.content}</h3>;
                }
                return <p key={`${section.kind}-${index}`}>{section.content}</p>;
              })}
            </article>

            <aside className="quality-panel">
              <div className="quality-heading">
                <div>
                  <span>QUALITY REPORT</span>
                  <h3>Context check</h3>
                </div>
                <span className={`confidence confidence-${result.confidence}`}>
                  {result.confidence}
                </span>
              </div>
              <p className="quality-summary">{result.qualitySummary}</p>

              <div className="quality-list">
                <div>
                  <Check size={15} aria-hidden="true" />
                  Full-document context used
                </div>
                <div>
                  <Check size={15} aria-hidden="true" />
                  Names and numbers checked
                </div>
                <div>
                  <Check size={15} aria-hidden="true" />
                  Terminology consistency checked
                </div>
              </div>

              {result.terminology.length > 0 && (
                <div className="report-block">
                  <h4>Terminology decisions</h4>
                  {result.terminology.slice(0, 5).map((term, index) => (
                    <div className="term-row" key={`${term.source}-${index}`}>
                      <span>{term.source}</span>
                      <ArrowRight size={13} aria-hidden="true" />
                      <strong>{term.chosen}</strong>
                    </div>
                  ))}
                </div>
              )}

              {result.reviewFlags.length > 0 && (
                <div className="report-block flags">
                  <h4>Worth a human look</h4>
                  {result.reviewFlags.map((flag, index) => (
                    <p key={`${flag}-${index}`}>{flag}</p>
                  ))}
                </div>
              )}

              <div className="download-stack">
                <button type="button" onClick={downloadDocx}>
                  <Download size={17} aria-hidden="true" />
                  Download Word file
                </button>
                <button type="button" onClick={downloadText}>
                  <FileText size={17} aria-hidden="true" />
                  Download plain text
                </button>
                <button type="button" onClick={copyTranslation}>
                  {copied ? (
                    <Check size={17} aria-hidden="true" />
                  ) : (
                    <Copy size={17} aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy translation"}
                </button>
              </div>
            </aside>
          </div>
        </section>
      )}

      <footer>
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <strong>VERTA</strong>
        </div>
        <p>Context-aware AI translation for documents and images.</p>
        <div>
          <ShieldCheck size={15} aria-hidden="true" />
          Local-first · Bring your own key
        </div>
      </footer>
    </main>
  );
}
