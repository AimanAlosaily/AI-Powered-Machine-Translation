import { strFromU8, unzipSync } from "fflate";
import { createCompactTranslator, supportsCompactTranslation } from "./local-translation/client";
import { isPlanCached, planSizeMB, translationPlan, type Stage } from "./local-translation/models";
import { IS_DESKTOP } from "./runtime";
import { cleanOcrText } from "./ocr-clean";

// The desktop app ships both models, so they are always ready there.
const modelsReady = (plan: Stage[]) => (IS_DESKTOP ? Promise.resolve(true) : isPlanCached(plan));

export { planSizeMB, translationPlan } from "./local-translation/models";

export type TranslationSection = {
  kind:
    | "title"
    | "heading"
    | "paragraph"
    | "list"
    | "table"
    | "caption"
    | "other";
  content: string;
};

export type TranslationResult = {
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  title: string;
  sections: TranslationSection[];
  qualitySummary: string;
  translationNotes: string[];
  terminology: Array<{
    source: string;
    chosen: string;
    rationale: string;
  }>;
  reviewFlags: string[];
  confidence: "high" | "medium" | "low";
};

export type TranslationOptions = {
  sourceLanguage: string;
  sourceCode: string;
  targetLanguage: string;
  targetCode: string;
  glossary: string;
};

export type OfflineProgress = {
  progress: number;
  message: string;
};

export const SUPPORTED_EXTENSIONS = [
  "pdf",
  "docx",
  "rtf",
  "odt",
  "txt",
  "md",
  "csv",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type ExtractedDocument = {
  documentType: string;
  sections: TranslationSection[];
  plainText: string;
  usedOcr: boolean;
  /** Unclear OCR lines (logos, edges, blur) left out before translation. */
  ocrSkippedLines: number;
};

type GlossaryEntry = {
  source: string;
  target: string;
};

function assetUrl(path: string) {
  return `${BASE_PATH}${path}`;
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Translation cancelled.", "AbortError");
  }
}

export function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function validateFile(file: File) {
  const extension = getFileExtension(file.name);

  if (
    !SUPPORTED_EXTENSIONS.includes(
      extension as (typeof SUPPORTED_EXTENSIONS)[number],
    )
  ) {
    throw new Error(
      "Offline Verta supports PDF, DOCX, PPTX, ODT, RTF, text, CSV, PNG, JPG, and WebP files.",
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("The file is over the 20 MB limit.");
  }
}

export function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp"].includes(getFileExtension(file.name))
  );
}

function titleFromFilename(filename: string) {
  return (
    filename
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Translation"
  );
}

function cleanText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferSections(text: string, filename: string): TranslationSection[] {
  const blocks = cleanText(text)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    throw new Error("No readable text was found in this file.");
  }

  return blocks.map((block, index) => {
    const withoutMarkdown = block.replace(/^#{1,6}\s+/, "").trim();
    const looksLikeHeading =
      /^#{1,6}\s+/.test(block) ||
      (block.length < 100 &&
        !/[.!?。！？]\s*$/.test(block) &&
        !block.includes("\n"));
    const looksLikeList = /^(?:[-*•]|\d+[.)])\s/m.test(block);
    const looksLikeTable =
      getFileExtension(filename) === "csv" ||
      (block.includes(",") && block.split(",").length >= 3);

    return {
      kind:
        index === 0 && looksLikeHeading
          ? "title"
          : looksLikeHeading
            ? "heading"
            : looksLikeTable
              ? "table"
              : looksLikeList
                ? "list"
                : "paragraph",
      content: withoutMarkdown,
    };
  });
}

function xmlParagraphs(xml: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("The document structure could not be read.");
  }

  return Array.from(document.getElementsByTagName("*"))
    .filter((element) => ["p", "h"].includes(element.localName))
    .map((element) => cleanText(element.textContent ?? ""))
    .filter(Boolean);
}

function unzipFile(bytes: ArrayBuffer) {
  return unzipSync(new Uint8Array(bytes));
}

function readZipEntry(
  archive: ReturnType<typeof unzipSync>,
  path: string,
) {
  const entry = archive[path];
  if (!entry) {
    throw new Error("The document is missing a required content file.");
  }
  return strFromU8(entry);
}

async function extractDocx(file: File) {
  const archive = unzipFile(await file.arrayBuffer());
  const paragraphs = xmlParagraphs(readZipEntry(archive, "word/document.xml"));
  return paragraphs.join("\n\n");
}

async function extractOdt(file: File) {
  const archive = unzipFile(await file.arrayBuffer());
  const paragraphs = xmlParagraphs(readZipEntry(archive, "content.xml"));
  return paragraphs.join("\n\n");
}

async function extractPptx(file: File) {
  const archive = unzipFile(await file.arrayBuffer());
  const slideNames = Object.keys(archive)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/\d+/)?.[0] ?? 0);
      const rightNumber = Number(right.match(/\d+/)?.[0] ?? 0);
      return leftNumber - rightNumber;
    });

  const slides = slideNames
    .map((name) => xmlParagraphs(strFromU8(archive[name])).join("\n"))
    .filter(Boolean);

  return slides.join("\n\n");
}

function extractRtf(text: string) {
  return cleanText(
    text
      .replace(/\\par[d]?\b/g, "\n\n")
      .replace(/\\line\b/g, "\n")
      .replace(/\\tab\b/g, "\t")
      .replace(/\\'[0-9a-fA-F]{2}/g, (match) =>
        String.fromCharCode(Number.parseInt(match.slice(2), 16)),
      )
      .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
      .replace(/\\([{}\\])/g, "$1")
      .replace(/[{}]/g, ""),
  );
}

async function extractPdf(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: OfflineProgress) => void,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl("/offline/pdf.worker.min.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      abortIfNeeded(signal);
      onProgress({
        progress: 8 + Math.round((pageNumber / document.numPages) * 20),
        message: `Reading PDF page ${pageNumber} of ${document.numPages}`,
      });

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let currentLine = "";

      for (const item of content.items) {
        if (!("str" in item)) continue;
        currentLine += `${currentLine ? " " : ""}${item.str}`;
        if ("hasEOL" in item && item.hasEOL) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      pages.push(lines.filter(Boolean).join("\n"));
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages.join("\n\n");
}

async function extractImage(
  file: File,
  sourceCode: string,
  signal: AbortSignal,
  onProgress: (progress: OfflineProgress) => void,
) {
  const language =
    sourceCode === "ar" ? "ara" : sourceCode === "en" ? "eng" : "";

  if (!language) {
    throw new Error(
      "Offline image reading currently supports English and Arabic source text. Choose one of those source languages or use a text document.",
    );
  }

  const { createWorker } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const handleAbort = () => {
    void worker?.terminate();
  };
  signal.addEventListener("abort", handleAbort, { once: true });

  try {
    worker = await createWorker(language, 1, {
      workerPath: assetUrl("/offline/worker.min.js"),
      langPath: assetUrl("/offline"),
      corePath: assetUrl("/offline/tesseract-core"),
      logger(message) {
        if (typeof message.progress === "number") {
          onProgress({
            progress: 5 + Math.round(message.progress * 25),
            message:
              message.status === "recognizing text"
                ? "Reading text from the image"
                : "Preparing offline image reader",
          });
        }
      },
    });
    abortIfNeeded(signal);
    const output = await worker.recognize(file, {}, { text: true, blocks: true });
    abortIfNeeded(signal);
    // Photos contain logos, frames and blur that OCR turns into junk; keep only
    // confidently read text so it is not translated into nonsense.
    const cleaned = cleanOcrText(output.data.blocks ?? [], sourceCode === "ar" ? "ar" : "en");
    return { text: cleanText(cleaned.text), skippedLines: cleaned.skippedLines };
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // tesseract.js can reject with strings or plain objects; give a clear message.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The image reader could not process this file. If you are offline, connect once so Verta can save its OCR files, then try again. (${detail.slice(0, 160)})`,
    );
  } finally {
    signal.removeEventListener("abort", handleAbort);
    await worker?.terminate();
  }
}

async function extractDocument(
  file: File,
  sourceCode: string,
  signal: AbortSignal,
  onProgress: (progress: OfflineProgress) => void,
): Promise<ExtractedDocument> {
  abortIfNeeded(signal);
  const extension = getFileExtension(file.name);
  let text = "";
  let ocrSkippedLines = 0;

  onProgress({ progress: 5, message: "Reading the file on this device" });

  if (isImageFile(file)) {
    const ocr = await extractImage(file, sourceCode, signal, onProgress);
    if (!ocr.text) {
      throw new Error("No clear text was found in this image. Try a sharper, straight-on photo with good light, and check the source language.");
    }
    text = ocr.text;
    ocrSkippedLines = ocr.skippedLines;
  } else if (extension === "pdf") {
    text = await extractPdf(file, signal, onProgress);
  } else if (extension === "docx") {
    text = await extractDocx(file);
  } else if (extension === "pptx") {
    text = await extractPptx(file);
  } else if (extension === "odt") {
    text = await extractOdt(file);
  } else if (extension === "rtf") {
    text = extractRtf(await file.text());
  } else {
    text = await file.text();
  }

  abortIfNeeded(signal);
  const sections = inferSections(text, file.name);

  return {
    documentType: isImageFile(file)
      ? "Image"
      : extension === "pdf"
        ? "PDF"
        : extension.toUpperCase(),
    sections,
    plainText: sections.map((section) => section.content).join("\n\n"),
    usedOcr: isImageFile(file),
    ocrSkippedLines,
  };
}

function parseGlossary(glossary: string): GlossaryEntry[] {
  return glossary
    .split(/\r?\n/)
    .map((line) => line.split(/\s*(?:→|=>|=)\s*/, 2).map((part) => part.trim()))
    .filter(
      (parts): parts is [string, string] =>
        parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]),
    )
    .slice(0, 20)
    .map(([source, target]) => ({ source, target }));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTerm(text: string, automatic: string, preferred: string) {
  if (!automatic.trim()) return text;
  return text.replace(
    new RegExp(escapeRegExp(automatic.trim()), "giu"),
    preferred,
  );
}

/**
 * Signs and notices are often in ALL CAPS, which these models (trained on
 * normally cased text) translate badly: "YOU ARE ON A PREMISES" came back as
 * "you are on appetizers". Lines that are mostly capital letters are turned
 * into sentence case before English is translated; Arabic has no case.
 */
export function softenAllCaps(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const letters = line.match(/[A-Za-z]/g) ?? [];
      const capitals = line.match(/[A-Z]/g) ?? [];
      if (letters.length < 4 || capitals.length / letters.length < 0.8) return line;
      const lower = line.toLowerCase();
      return lower.replace(/[a-z]/, (first) => first.toUpperCase());
    })
    .join("\n");
}

function extractNumbers(text: string) {
  return text.match(/\p{N}+(?:[.,]\p{N}+)*/gu) ?? [];
}

export type PairStatus =
  | "checking"
  | "available"
  | "downloadable"
  | "unavailable"
  | "unsupported";

export async function getPairAvailability(
  sourceCode: string,
  targetCode: string,
): Promise<Exclude<PairStatus, "checking">> {
  const plan = translationPlan(sourceCode, targetCode);
  if (!plan) return "unavailable";
  if (plan.length === 0) return "available";
  if (!supportsCompactTranslation()) return "unsupported";
  return (await modelsReady(plan)) ? "available" : "downloadable";
}

const LANGUAGE_NAMES: Record<string, string> = { ar: "Arabic", en: "English" };

const DIRECTIONS = [["en", "ar"], ["ar", "en"]] as const;

/** Download size of both directions' models, in MB. */
export const OFFLINE_PACK_MB = DIRECTIONS.reduce(
  (sum, [source, target]) => sum + planSizeMB(translationPlan(source, target)!),
  0,
);

/** True when both directions' model files are in this browser's cache. */
export async function isOfflineReady() {
  const cached = await Promise.all(
    DIRECTIONS.map(([source, target]) => modelsReady(translationPlan(source, target)!)),
  );
  return cached.every(Boolean);
}

/**
 * Downloads and caches both directions' models so the installed app can
 * translate either way with no internet. Each model is loaded once in a worker
 * (which saves its files to the cache) and released before the next one.
 */
export async function saveForOffline(
  signal: AbortSignal,
  onMessage: (message: string) => void,
) {
  if (!supportsCompactTranslation()) {
    throw new Error("This browser needs WebAssembly and Web Workers for local translation.");
  }
  for (const [source, target] of DIRECTIONS) {
    const plan = translationPlan(source, target)!;
    if (await modelsReady(plan)) continue;
    for (const stage of plan) {
      abortIfNeeded(signal);
      const label = `${LANGUAGE_NAMES[stage.source]} → ${LANGUAGE_NAMES[stage.target]}`;
      onMessage(`Saving the ${label} model`);
      const translator = await createCompactTranslator(stage, signal, (message) => {
        onMessage(`${label}: ${message}`);
      });
      translator.destroy();
    }
  }
}

export async function translateFile({
  file,
  options,
  signal,
  onProgress,
}: {
  file: File;
  options: TranslationOptions;
  signal: AbortSignal;
  onProgress: (progress: OfflineProgress) => void;
}) {
  validateFile(file);
  abortIfNeeded(signal);

  const plan = translationPlan(options.sourceCode, options.targetCode);
  if (!plan) {
    throw new Error("Verta translates between Arabic and English.");
  }
  if (plan.length > 0 && !supportsCompactTranslation()) {
    throw new Error("This browser needs WebAssembly and Web Workers for local translation.");
  }

  // Read the whole file first so OCR/PDF workers are finished and terminated
  // before any model allocates memory.
  const extracted = await extractDocument(
    file,
    options.sourceCode,
    signal,
    onProgress,
  );
  if (plan.length > 0 && !navigator.onLine && !(await modelsReady(plan))) {
    throw new Error("This translation model is not fully cached. Connect once and complete a translation in this direction before using it offline.");
  }

  const glossary = parseGlossary(options.glossary);
  const terminology: TranslationResult["terminology"] = glossary.map((entry) => ({
    source: entry.source,
    chosen: entry.target,
    rationale: "Preferred term supplied by the user.",
  }));

  // Glossary source terms travel through the same stages as the document, so
  // each term's automatic translation can be swapped for the preferred one.
  let texts = [
    ...glossary.map((entry) => entry.source),
    ...extracted.sections.map((section) =>
      options.sourceCode === "en" && plan.length > 0 ? softenAllCaps(section.content) : section.content,
    ),
  ];

  for (const stage of plan) {
    abortIfNeeded(signal);
    onProgress({
      progress: 35,
      message: `Loading the ${LANGUAGE_NAMES[stage.source]} → ${LANGUAGE_NAMES[stage.target]} model`,
    });
    // One model in one worker; the worker is terminated when this ends.
    const translator = await createCompactTranslator(stage, signal, (message) => {
      onProgress({ progress: 35, message });
    });
    try {
      const output: string[] = [];
      for (let index = 0; index < texts.length; index += 1) {
        abortIfNeeded(signal);
        onProgress({
          progress: Math.round(35 + 60 * ((index + 1) / texts.length)),
          message: `Translating section ${index + 1} of ${texts.length}`,
        });
        output.push(await translator.translate(texts[index]));
      }
      texts = output;
    } finally {
      translator.destroy();
    }
  }

  const automaticTerms = texts.slice(0, glossary.length);
  const translatedSections = extracted.sections.map((section, index) => {
    let content = texts[glossary.length + index];
    glossary.forEach((entry, termIndex) => {
      const automatic = plan.length > 0 ? automaticTerms[termIndex] : entry.source;
      content = replaceTerm(content, automatic, entry.target);
    });
    return { ...section, content };
  });

  const translatedText = translatedSections
    .map((section) => section.content)
    .join("\n\n");
  const sourceNumbers = extractNumbers(extracted.plainText);
  const translatedNumbers = extractNumbers(translatedText);
  const reviewFlags: string[] = [];

  if (sourceNumbers.length !== translatedNumbers.length) {
    reviewFlags.push(
      `The source has ${sourceNumbers.length} numeric items and the result has ${translatedNumbers.length}; compare dates, amounts, and identifiers. Small numbers are sometimes written out as words.`,
    );
  }
  if (extracted.usedOcr) {
    reviewFlags.push(
      "Image text was read with local OCR. Check names, small print, and low-contrast areas.",
    );
  }
  if (extracted.ocrSkippedLines > 0) {
    const count = extracted.ocrSkippedLines;
    reviewFlags.push(
      `Skipped ${count} unclear line${count === 1 ? "" : "s"} in the image (logos, edges or blurry text) so ${count === 1 ? "it was" : "they were"} not translated as nonsense.`,
    );
  }
  reviewFlags.push(
    "This keyless mode does not perform a cloud semantic review; important legal, medical, or financial text needs human review.",
  );

  onProgress({ progress: 100, message: "Offline translation complete" });

  const route =
    plan.length === 0
      ? "Source text retained without translation."
      : "Translated on this device with the open-weight OPUS-MT model (8-bit).";

  return {
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    documentType: extracted.documentType,
    title:
      translatedSections.find((section) => section.kind === "title")
        ?.content ?? titleFromFilename(file.name),
    sections: translatedSections,
    qualitySummary: `${route} Section order was preserved, preferred terminology replacements were applied, and numeric item counts were compared.`,
    translationNotes: [
      "No file, key, or translation text was sent to Verta or a cloud API.",
      "Offline mode favors privacy and cost over advanced context rewriting.",
      ...(plan.length > 0 ? ["The small open-weight model translates one sentence at a time. It does not reason over the entire document; glossary replacement is best-effort."] : []),
    ],
    terminology,
    reviewFlags,
    confidence: reviewFlags.length > 1 ? "low" : "medium",
  } satisfies TranslationResult;
}

export function getFullTranslation(result: TranslationResult) {
  return result.sections.map((section) => section.content).join("\n\n");
}
