// Cleans OCR output from photos before translation. Logos, sign frames, walls
// and blurry edges produce junk "text"; translated, it becomes nonsense. Real
// words score high in Tesseract's per-word confidence (typically 75–96) while
// junk scores low (0–60), so lines are kept or dropped by how much of their
// text is confidently read in the expected script.
//
// Thresholds were tuned on real photos: an Arabic information sign and an
// English warning notice (see tests/compact-model.browser.mjs).

export type OcrWord = { text: string; confidence: number };
export type OcrLine = { words: OcrWord[] };
export type OcrBlock = { paragraphs: { lines: OcrLine[] }[] };

const SCRIPT_LETTERS = {
  ar: /[ء-يٱ-ۓ]/gu,
  en: /[A-Za-z]/gu,
} as const;

// Tokens with no letters or digits that are not ordinary punctuation.
const JUNK_SYMBOLS = /^[^\p{L}\p{N}.,:;!?؟،؛()"'«»\-]+$/u;

export function cleanOcrText(blocks: OcrBlock[], script: keyof typeof SCRIPT_LETTERS) {
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
  const expected = (text: string) => count(text, SCRIPT_LETTERS[script]);
  const anyLetters = (text: string) => count(text, /\p{L}/gu);
  let keptLines = 0;
  let skippedLines = 0;
  const paragraphs: string[] = [];

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      const lines: string[] = [];
      for (const line of paragraph.lines) {
        const words = line.words
          .map((word) => ({ text: word.text.trim(), confidence: word.confidence, letters: expected(word.text) }))
          .filter((word) => word.text);
        const lettered = words.filter((word) => anyLetters(word.text) > 0);
        if (lettered.length === 0) {
          if (words.length) skippedLines += 1;
          continue;
        }
        // Long, confidently read words in the expected script mark real text.
        const good = lettered.filter((word) => word.confidence >= 60 && word.letters >= 2);
        const totalLetters = lettered.reduce((sum, word) => sum + Math.max(1, anyLetters(word.text)), 0);
        const share = good.reduce((sum, word) => sum + word.letters, 0) / totalLetters;
        const strong = good.some((word) => word.confidence >= 85 && word.letters >= 4);
        if (!((good.length >= 2 && share >= 0.5) || (strong && share >= 0.35))) {
          skippedLines += 1;
          continue;
        }
        // Inside a kept line, drop stray low-confidence fragments at the edges.
        // Long words stay even when unsure: they are usually real but misspelt.
        const text = words
          .filter((word) => {
            if (word.letters >= 6) return true;
            if (word.confidence < 40) return false;
            // Short tokens (two letters or fewer, bare numbers, marks) need 60.
            if (anyLetters(word.text) <= 2 && word.confidence < 60) return false;
            return !JUNK_SYMBOLS.test(word.text);
          })
          .map((word) => word.text)
          .join(" ")
          .trim();
        if (text) {
          lines.push(text);
          keptLines += 1;
        }
      }
      if (lines.length === 0) continue;
      // Prose wraps sentences across lines; rejoin a line to the previous one
      // when that one is full-width and did not end a sentence, so the model
      // sees whole sentences. Short lines (titles, notices) stay separate.
      let joined = lines[0];
      for (let index = 1; index < lines.length; index += 1) {
        const previous = lines[index - 1];
        const wrapped = previous.length >= 35 && !/[.!?؟:]["')»]*$/u.test(previous);
        joined += (wrapped ? " " : "\n") + lines[index];
      }
      paragraphs.push(joined);
    }
  }

  return { text: paragraphs.join("\n\n"), keptLines, skippedLines };
}
