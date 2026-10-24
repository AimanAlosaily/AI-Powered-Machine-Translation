// Downloads the pinned translation models into <out>/<model id>/ for the
// desktop app, which ships them so it never needs the internet. The model
// list and revisions come from app/local-translation/models.ts. Every file is
// checked against the hash Hugging Face publishes for that exact revision:
// SHA-256 for large (LFS) files, the git blob SHA-1 for small ones.
//
// Usage: node --import tsx scripts/fetch-models.mjs out/models
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MODEL_FILES, translationPlan } from "../app/local-translation/models.ts";

const outDir = process.argv[2];
if (!outDir) throw new Error("Usage: fetch-models.mjs <output directory>");

const models = new Map();
for (const [source, target] of [["en", "ar"], ["ar", "en"]]) {
  for (const stage of translationPlan(source, target)) models.set(stage.model.id, stage.model);
}

async function fetchOk(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= 4) throw new Error(`${url}: ${error.message}`);
      await new Promise((done) => setTimeout(done, attempt * 3000));
    }
  }
}

let total = 0;
for (const { id, revision } of models.values()) {
  const tree = await (await fetchOk(`https://huggingface.co/api/models/${id}/tree/${revision}?recursive=true`)).json();
  const entries = new Map(tree.map((entry) => [entry.path, entry]));
  for (const file of MODEL_FILES) {
    const entry = entries.get(file);
    if (!entry) throw new Error(`${id}@${revision} has no ${file}`);
    const bytes = Buffer.from(await (await fetchOk(`https://huggingface.co/${id}/resolve/${revision}/${file}`)).arrayBuffer());
    const expectedSize = entry.lfs?.size ?? entry.size;
    if (bytes.length !== expectedSize) throw new Error(`${id}/${file}: ${bytes.length} bytes, expected ${expectedSize}`);
    if (entry.lfs) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== entry.lfs.oid) throw new Error(`${id}/${file}: SHA-256 mismatch`);
    } else {
      const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (blob !== entry.oid) throw new Error(`${id}/${file}: git blob hash mismatch`);
    }
    const path = join(outDir, id, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    total += bytes.length;
    console.log(`${id}/${file}  ${(bytes.length / 1e6).toFixed(1)} MB  verified`);
  }
}
console.log(`Saved ${models.size} models, ${(total / 1e6).toFixed(1)} MB, to ${outDir}`);
