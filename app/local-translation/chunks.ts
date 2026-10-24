export const MAX_INPUT_TOKENS = 192;
export const MAX_NEW_TOKENS = 384;

type SentenceSegmenter = { segment(input: string): Iterable<{ segment: string }> };

// Sentence end, optional closing quote/bracket, then whitespace. The whitespace
// stays with the preceding sentence so joining the pieces restores the input.
const SENTENCE_BOUNDARY = /(?<=[.!?؟。！？…]+["'”’»)\]]*\s+)(?!\s)/u;

function defaultSegmenter(): SentenceSegmenter | null {
  return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "sentence" })
    : null;
}

// OPUS-MT is trained on sentence pairs. Given several sentences at once it can
// silently omit some of them, so the worker translates one sentence per call.
export function splitSentences(
  text: string,
  segmenter: SentenceSegmenter | null = defaultSegmenter(),
): string[] {
  const pieces = segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : text.split(SENTENCE_BOUNDARY);
  return pieces.filter((piece) => piece.length > 0);
}

// Split the original string, never a decoded/truncated token sequence. Joining
// the chunks exactly reconstructs the input, including Arabic and surrogate pairs.
export function splitToTokenBudget(
  text: string,
  countTokens: (text: string) => number,
  budget = MAX_INPUT_TOKENS,
): string[] {
  if (!Number.isInteger(budget) || budget < 1) throw new Error("Invalid token budget.");
  if (countTokens(text) <= budget) return [text];

  const characters = Array.from(text);
  if (characters.length < 2) {
    throw new Error("A source character exceeds the model's token budget.");
  }
  const middle = Math.floor(characters.length / 2);
  let boundary = middle;
  // Prefer a sentence boundary, then whitespace, near the middle.
  for (const pattern of [/[.!?؟。！？]/u, /\s/u]) {
    let found = false;
    for (let i = middle; i >= Math.max(1, Math.floor(middle / 2)); i--) {
      if (pattern.test(characters[i - 1])) {
        boundary = i;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  return [
    ...splitToTokenBudget(characters.slice(0, boundary).join(""), countTokens, budget),
    ...splitToTokenBudget(characters.slice(boundary).join(""), countTokens, budget),
  ];
}

export function assertCompleteGeneration(tokenCount: number) {
  // Marian forces EOS at the output limit; EOS alone cannot prove completeness.
  if (tokenCount >= MAX_NEW_TOKENS + 1) {
    throw new Error("The model reached its output limit. Split this section into shorter sentences and try again; no partial translation was accepted.");
  }
}
