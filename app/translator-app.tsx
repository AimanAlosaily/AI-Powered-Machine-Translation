"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  DownloadCloud,
  FileImage,
  FileText,
  HardDrive,
  Languages,
  LoaderCircle,
  LockKeyhole,
  MonitorCheck,
  PackageCheck,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WifiOff,
  X,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getFileExtension,
  getFullTranslation,
  getPairAvailability,
  MAX_FILE_SIZE,
  type PairStatus,
  planSizeMB,
  translateFile,
  TranslationResult,
  translationPlan,
  validateFile,
} from "./translation";
import { LANGUAGES } from "./languages";


const RTL_CODES = new Set(["ar", "iw"]);
const ACCEPTED_FILES =
  ".pdf,.docx,.rtf,.odt,.txt,.md,.csv,.pptx,.png,.jpg,.jpeg,.webp";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Phase = "idle" | "reading" | "translating" | "done" | "error";
type Plan = ReturnType<typeof translationPlan>;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

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

function routeDetail(plan: Plan) {
  if (!plan || plan.length === 0) return "";
  if (plan.length === 2) {
    return "No direct small model exists for this pair, so Verta chains two OPUS-MT models through English, one at a time.";
  }
  if (plan[0].model.family === "nllb") {
    return "Uses NLLB-200, a larger multilingual model. On a 6 GB device, close other heavy tabs first.";
  }
  return "Uses a small OPUS-MT model for this direction.";
}

function statusCopy(status: PairStatus, online: boolean, plan: Plan) {
  if (plan && plan.length === 0) {
    return { title: "Same language", detail: "Verta extracts the text without translating it." };
  }
  if (status === "unsupported") {
    return { title: "Local model unavailable", detail: "Use a current browser with WebAssembly and Web Workers." };
  }
  if (status === "unavailable" || !plan) {
    return { title: "Pair unavailable", detail: "No local model covers this combination. Choose another pair." };
  }
  if (status === "checking") {
    return { title: "Checking saved models", detail: "Looking for this pair’s model files on this device." };
  }
  if (status === "available") {
    return { title: "Ready offline", detail: `${routeDetail(plan)} Runs on this device; no GPU or API key needed.` };
  }
  return {
    title: online ? `One-time download · about ${planSizeMB(plan)} MB` : "Connect once to download this model",
    detail: `${routeDetail(plan)} Later translations in this direction work offline.`,
  };
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

function subscribeInstalled(notify: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", notify);
  window.addEventListener("appinstalled", notify);
  return () => {
    media.removeEventListener("change", notify);
    window.removeEventListener("appinstalled", notify);
  };
}

export function TranslatorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("English");
  const [targetLanguage, setTargetLanguage] = useState("Arabic");
  const [glossary, setGlossary] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pairState, setPairState] = useState<{ pair: string; status: PairStatus }>({ pair: "", status: "checking" });
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const isInstalled = useSyncExternalStore(subscribeInstalled, () => window.matchMedia("(display-mode: standalone)").matches, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const sourceCode =
    LANGUAGES.find(([name]) => name === sourceLanguage)?.[1] ?? "en";
  const targetCode =
    LANGUAGES.find(([name]) => name === targetLanguage)?.[1] ?? "ar";
  const pairKey = `${sourceCode}-${targetCode}`;
  const pairStatus = pairState.pair === pairKey ? pairState.status : "checking";
  const isRtl = RTL_CODES.has(targetCode);
  const isWorking = phase === "reading" || phase === "translating";
  const translationText = useMemo(
    () => (result ? getFullTranslation(result) : ""),
    [result],
  );
  const plan = useMemo(() => translationPlan(sourceCode, targetCode), [sourceCode, targetCode]);
  const engineCopy = statusCopy(pairStatus, isOnline, plan);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, {
        scope: `${BASE_PATH || ""}/`,
      });
    }

    return () => {
      controllerRef.current?.abort();
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getPairAvailability(sourceCode, targetCode).then((availability) => {
      if (active) setPairState({ pair: `${sourceCode}-${targetCode}`, status: availability });
    });
    return () => {
      active = false;
    };
  }, [sourceCode, targetCode, isOnline, phase]);

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
    if (controllerRef.current) return;
    if (!file) {
      setError("Choose a document or image first.");
      setPhase("error");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setResult(null);
    setProgress(2);
    setProgressMessage("Starting the on-device engine");
    setPhase("reading");

    try {
      const nextResult = await translateFile({
        file,
        options: {
          sourceLanguage,
          sourceCode,
          targetLanguage,
          targetCode,
          glossary,
        },
        signal: controller.signal,
        onProgress(update) {
          if (controllerRef.current !== controller || controller.signal.aborted) return;
          setProgress((previous) => Math.max(previous, update.progress));
          setProgressMessage(update.message);
          setPhase(
            /translat/i.test(update.message)
              ? "translating"
              : "reading",
          );
        },
      });
      if (controllerRef.current !== controller || controller.signal.aborted) return;
      setResult(nextResult);
      setPhase("done");
    } catch (translationError) {
      if (controllerRef.current !== controller) return;
      if (
        translationError instanceof DOMException &&
        translationError.name === "AbortError"
      ) {
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
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const cancelTranslation = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase("idle");
  };

  const reset = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setFile(null);
    setResult(null);
    setError("");
    setPhase("idle");
    setProgress(0);
    setCopied(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
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
      creator: "Verta Offline",
      title: result.title,
      description: `Translated offline into ${result.targetLanguage} with Verta`,
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
          <span>No keys</span>
          <span>Device-only</span>
          <span>Offline after setup</span>
        </div>
        {installPrompt && !isInstalled ? (
          <button
            className="install-button"
            type="button"
            onClick={installApp}
          >
            <DownloadCloud size={14} aria-hidden="true" />
            Install Verta
          </button>
        ) : (
          <span className="privacy-pill">
            <LockKeyhole size={14} aria-hidden="true" />
            No keys · no uploads
          </span>
        )}
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Private translation, built in
          </div>
          <h1>
            Meaning in.
            <br />
            <span>Nothing out.</span>
          </h1>
          <p className="hero-lede">
            Translate documents between 35 languages with small open-weight
            models that run on your CPU. No account, API key, or file upload.
          </p>

          <div className="proof-strip">
            <div>
              <strong>01</strong>
              <span>Local file reading</span>
            </div>
            <div>
              <strong>02</strong>
              <span>Open-weight models</span>
            </div>
            <div>
              <strong>03</strong>
              <span>Works disconnected</span>
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
            disabled={isWorking}
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
              <span>
                or click to browse · up to {MAX_FILE_SIZE / 1024 / 1024} MB
              </span>
            </div>
          )}

          <div className="form-divider" />

          <div className="card-heading compact">
            <div>
              <span className="step-label">02 / LANGUAGE PAIR</span>
              <h2>Set the direction</h2>
            </div>
            <Languages size={22} aria-hidden="true" />
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Source language</span>
              <select
                disabled={isWorking}
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
              >
                {LANGUAGES.map(([name, code]) => (
                  <option key={code} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Target language</span>
              <select
                disabled={isWorking}
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
          </div>

          <div
            className={`engine-status engine-${pairStatus}`}
            aria-live="polite"
          >
            {pairStatus === "available" ? (
              <PackageCheck size={20} aria-hidden="true" />
            ) : pairStatus === "unsupported" ||
              pairStatus === "unavailable" ? (
              <AlertCircle size={20} aria-hidden="true" />
            ) : (
              <HardDrive size={20} aria-hidden="true" />
            )}
            <div>
              <strong>{engineCopy.title}</strong>
              <span>{engineCopy.detail}</span>
            </div>
            <span className="network-state">
              {isOnline ? (
                <MonitorCheck size={13} aria-hidden="true" />
              ) : (
                <WifiOff size={13} aria-hidden="true" />
              )}
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>

          <details className="context-panel">
            <summary>
              <ScanText size={17} aria-hidden="true" />
              Add preferred terminology
              <span>Optional</span>
            </summary>
            <div className="context-fields context-fields-single">
              <label className="field">
                <span>Glossary</span>
                <textarea
                  disabled={isWorking}
                  value={glossary}
                  onChange={(event) => setGlossary(event.target.value)}
                  placeholder={"One term per line, for example:\nconsideration → المقابل"}
                  rows={4}
                />
              </label>
            </div>
          </details>

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
                  {progressMessage || "Working on this device"}
                </span>
                <button type="button" onClick={cancelTranslation}>
                  Cancel
                </button>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <p>
                The file stays in this tab. Large PDFs and image OCR can take a
                little longer.
              </p>
            </div>
          ) : (
            <button className="translate-button" type="submit">
              Translate on this device
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          )}

          <p className="consent-note">
            Nothing is uploaded. Each direction downloads its open-weight model
            once from Hugging Face; keep site data to reuse it offline. Image OCR
            supports English and Arabic.
          </p>
        </form>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="section-kicker">
          <span>THE OFFLINE METHOD</span>
          <span>Private by design</span>
        </div>
        <div className="method-grid">
          <div className="method-intro">
            <h2 id="method-title">What changed to remove the key.</h2>
            <p>
              Verta now favors privacy, zero cost, and offline access over the
              deeper reasoning of a cloud model. The tradeoff is visible—not
              hidden.
            </p>
          </div>
          <article className="method-card">
            <span>01</span>
            <ScanText size={24} aria-hidden="true" />
            <h3>Local extraction</h3>
            <p>
              Text is read from documents in your browser. English and Arabic
              images use an OCR model shipped with the app.
            </p>
          </article>
          <article className="method-card">
            <span>02</span>
            <Languages size={24} aria-hidden="true" />
            <h3>A small local model</h3>
            <p>
              Every pair runs on the CPU with one model loaded at a time, one
              sentence at a time. Its memory is released when the work ends.
            </p>
          </article>
          <article className="method-card">
            <span>03</span>
            <ShieldCheck size={24} aria-hidden="true" />
            <h3>Basic integrity checks</h3>
            <p>
              Section order, preferred terms, and numeric item counts are
              checked locally without claiming a cloud-grade semantic review.
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
                Offline translation complete
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
                  return (
                    <h2 key={`${section.kind}-${index}`}>
                      {section.content}
                    </h2>
                  );
                }
                if (section.kind === "heading") {
                  return (
                    <h3 key={`${section.kind}-${index}`}>
                      {section.content}
                    </h3>
                  );
                }
                return (
                  <p key={`${section.kind}-${index}`}>{section.content}</p>
                );
              })}
            </article>

            <aside className="quality-panel">
              <div className="quality-heading">
                <div>
                  <span>OFFLINE CHECKS</span>
                  <h3>Local report</h3>
                </div>
                <span className={`confidence confidence-${result.confidence}`}>
                  {result.confidence}
                </span>
              </div>
              <p className="quality-summary">{result.qualitySummary}</p>

              <div className="quality-list">
                <div>
                  <Check size={15} aria-hidden="true" />
                  Section order preserved
                </div>
                <div>
                  <Check size={15} aria-hidden="true" />
                  Numeric item counts compared
                </div>
                <div>
                  <Check size={15} aria-hidden="true" />
                  Preferred terminology applied
                </div>
              </div>

              {result.terminology.length > 0 && (
                <div className="report-block">
                  <h4>Preferred terminology</h4>
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
        <p>Private on-device translation for documents and images.</p>
        <div>
          <ShieldCheck size={15} aria-hidden="true" />
          Offline-ready · No keys
        </div>
      </footer>
    </main>
  );
}
