import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cleanOcrText, type OcrBlock } from "../app/ocr-clean";

// Real Tesseract.js output for two photos; see the fixture's "source" field.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ocr-real-photos.json", import.meta.url), "utf8"));
const toBlocks = (data: [string, number][][][][]): OcrBlock[] =>
  data.map((paragraphs) => ({
    paragraphs: paragraphs.map((lines) => ({
      lines: lines.map((words) => ({ words: words.map(([text, confidence]) => ({ text, confidence })) })),
    })),
  }));

test("Arabic sign photo: junk from logos and the frame is removed, real text kept", () => {
  const { text, keptLines, skippedLines } = cleanOcrText(toBlocks(fixture.acre), "ar");
  assert.equal(keptLines + skippedLines, 57);
  assert.ok(skippedLines >= 25, `only ${skippedLines} junk lines removed`);
  for (const real of ["تل عكا القديمه", "مكان مدينة عكا القديمة", "الملوك الفينيقيين", "أرض اسرائيل ومدن الشاطئ البناني"]) {
    assert.ok(text.includes(real), `lost real text: ${real}`);
  }
  for (const junk of ["مويو", "اااعباعرهها", "للللل", "©", "دايز", "وىأكزيف"]) {
    assert.ok(!text.includes(junk), `kept junk: ${junk}`);
  }
  // The title stays on its own line; wrapped prose lines are rejoined.
  assert.equal(text.split("\n")[0], "تل عكا القديمه");
  assert.ok(text.includes("العربية \" تل الفخار \" و أيضا بالأسم \" تل حفريات"));
});

test("English notice photo: wall texture removed, headings and notice lines kept", () => {
  const { text, skippedLines } = cleanOcrText(toBlocks(fixture.ireland), "en");
  assert.ok(skippedLines >= 6);
  assert.equal(
    text,
    [
      "OCCUPIERS LIABILITY ACT 1995",
      "",
      "IF YOU PASS",
      "BEYOND THIS POINT",
      "YOU ARE ON A PREMISES",
      "NOTICE",
      "THE OCCUPIER OF THIS PREMISES",
      // A full-width line without a sentence end is joined to the next.
      "GIVEN THE NATURE CHARACTER AND ACTIVITIES OF THESE PREMISES HEREBY IN;ACCORDANCE WITH",
      "",
      "SECTION 5(2) OF THE OCCUPIERS LIABILITY ACT 1995",
      "",
      "EXCLUDES THE DUTY OF CARE",
      "TOWARDS VISITORS",
      "UNDER SECTION 3 OF THE ACT",
      "WARNING",
      "UNAUTHORISED ENTRY IS",
      "PROHIBITED",
    ].join("\n"),
  );
});

test("clean text and empty input pass through sensibly", () => {
  const line = (words: [string, number][]) => ({ words: words.map(([text, confidence]) => ({ text, confidence })) });
  const clean = cleanOcrText([{ paragraphs: [{ lines: [line([["The", 95], ["meeting", 94], ["is", 96], ["tomorrow.", 93]])] }] }], "en");
  assert.deepEqual(clean, { text: "The meeting is tomorrow.", keptLines: 1, skippedLines: 0 });
  assert.deepEqual(cleanOcrText([], "ar"), { text: "", keptLines: 0, skippedLines: 0 });
});
