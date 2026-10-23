export const MAX_INPUT_TOKENS = 192;
export const MAX_NEW_TOKENS = 384;

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
