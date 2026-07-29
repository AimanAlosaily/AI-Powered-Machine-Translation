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
  targetLanguage: string;
  audience: string;
  tone: string;
  context: string;
  glossary: string;
};

export const SUPPORTED_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "rtf",
  "odt",
  "txt",
  "md",
  "csv",
  "ppt",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const translationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceLanguage: { type: "string" },
    targetLanguage: { type: "string" },
    documentType: { type: "string" },
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [
              "title",
              "heading",
              "paragraph",
              "list",
              "table",
              "caption",
              "other",
            ],
          },
          content: { type: "string" },
        },
        required: ["kind", "content"],
      },
    },
    qualitySummary: { type: "string" },
    translationNotes: {
      type: "array",
      items: { type: "string" },
    },
    terminology: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          chosen: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["source", "chosen", "rationale"],
      },
    },
    reviewFlags: {
      type: "array",
      items: { type: "string" },
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
  required: [
    "sourceLanguage",
    "targetLanguage",
    "documentType",
    "title",
    "sections",
    "qualitySummary",
    "translationNotes",
    "terminology",
    "reviewFlags",
    "confidence",
  ],
} as const;

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
      "This file type is not supported yet. Try PDF, Word, PowerPoint, text, CSV, PNG, JPG, or WebP.",
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("The file is over the 20 MB limit.");
  }
}

export function isImageFile(file: File) {
  return file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp"].includes(getFileExtension(file.name));
}

export function isPdfFile(file: File) {
  return (
    file.type === "application/pdf" || getFileExtension(file.name) === "pdf"
  );
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

export function buildTranslationPrompt(
  filename: string,
  options: TranslationOptions,
) {
  return `Translate the attached file into ${options.targetLanguage}.

Goal
Produce a complete, publication-ready translation that preserves meaning, intent, tone, and document structure. This is not a literal word-for-word exercise.

Context protocol
1. Read the entire file before choosing terminology.
2. Infer the source language, document type, subject, audience, register, and relationships between sections.
3. Resolve ambiguous expressions using whole-document context.
4. Keep terminology consistent across every section.
5. Preserve names, numbers, dates, units, citations, identifiers, and legally or technically meaningful qualifiers.
6. Translate every meaningful line. Do not summarize, omit, embellish, or add facts.
7. Recreate headings, paragraphs, lists, tables, and captions in their original reading order.
8. Write idiomatic ${options.targetLanguage} that sounds authored for the target reader.

Translation brief
- File: ${filename}
- Intended audience/domain: ${options.audience}
- Tone: ${options.tone}
- Additional context: ${options.context.trim() || "None supplied; infer from the complete file."}
- Preferred terminology/glossary: ${options.glossary.trim() || "None supplied; choose the most contextually accurate terms."}

Quality check
Before returning the result, silently compare the translation against the complete source for omissions, changed meaning, inconsistent terminology, and unnatural phrasing. Put only genuine ambiguities or items needing human confirmation in reviewFlags. Keep translationNotes concise and useful.

Return only the requested structured result.`;
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI returned an unreadable response.");
  }

  const root = payload as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof root.output_text === "string") {
    return root.output_text;
  }

  const text = root.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");

  if (!text) {
    throw new Error("The translation response did not contain any text.");
  }

  return text;
}

function parseStructuredResult(raw: string): TranslationResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as TranslationResult;
  } catch {
    throw new Error(
      "The translation finished, but its structure could not be read. Please try again.",
    );
  }
}

function errorFromApi(status: number, payload: unknown) {
  const message =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
      ? payload.error.message
      : "";

  if (status === 401) {
    return new Error("The API key was not accepted. Check it and try again.");
  }
  if (status === 429) {
    return new Error(
      "The API is temporarily rate-limited or the account has reached its usage limit.",
    );
  }
  if (status === 413) {
    return new Error("The file is too large for this request.");
  }

  return new Error(message || `Translation failed with status ${status}.`);
}

export async function translateFile({
  file,
  apiKey,
  options,
  safetyIdentifier,
  signal,
}: {
  file: File;
  apiKey: string;
  options: TranslationOptions;
  safetyIdentifier: string;
  signal: AbortSignal;
}) {
  const fileData = await fileToDataUrl(file);
  const prompt = buildTranslationPrompt(file.name, options);
  const attachment = isImageFile(file)
    ? {
        type: "input_image",
        image_url: fileData,
        detail: "original",
      }
    : {
        type: "input_file",
        filename: file.name,
        file_data: fileData,
        ...(isPdfFile(file) ? { detail: "high" } : {}),
      };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      store: false,
      safety_identifier: safetyIdentifier,
      reasoning: {
        effort: "medium",
        context: "current_turn",
      },
      max_output_tokens: 24000,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "context_aware_translation",
          strict: true,
          schema: translationSchema,
        },
      },
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }, attachment],
        },
      ],
    }),
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw errorFromApi(response.status, payload);
  }

  return parseStructuredResult(extractOutputText(payload));
}

export function getFullTranslation(result: TranslationResult) {
  return result.sections.map((section) => section.content).join("\n\n");
}

export function getSafetyIdentifier() {
  const storageKey = "verta-safety-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const value = `verta_${window.crypto.randomUUID()}`;
  window.localStorage.setItem(storageKey, value);
  return value;
}
