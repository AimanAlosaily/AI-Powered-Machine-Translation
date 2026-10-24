// Runs after the GitHub Pages export. Lists every file of the static app so the
// service worker can save all of it on the first visit, including code that is
// only loaded on demand (Word export, PDF reading, image OCR). Without this, a
// feature that was never used online would fail offline.
//
// It also stamps the service worker's cache name with a hash of the file list,
// so each deploy installs a fresh worker that saves the new files.
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = join(process.cwd(), "out");
const skip = new Set(["offline-manifest.json", "sw.js", ".nojekyll"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return files.flat();
}

const files = [];
const hash = createHash("sha256");
for (const path of (await walk(root)).sort()) {
  const file = relative(root, path).split(sep).join("/");
  if (skip.has(file)) continue;
  files.push(file);
  hash.update(file);
  hash.update(String((await stat(path)).size));
}
const version = hash.digest("hex").slice(0, 12);

await writeFile(
  join(root, "offline-manifest.json"),
  JSON.stringify({ version, files }),
);

const swPath = join(root, "sw.js");
const sw = await readFile(swPath, "utf8");
const marker = /const CACHE_NAME = "verta-offline-v(\d+)";/;
if (!marker.test(sw)) throw new Error("sw.js cache name marker not found");
await writeFile(swPath, sw.replace(marker, `const CACHE_NAME = "verta-offline-v$1-${version}";`));

console.log(`offline-manifest.json: ${files.length} files, cache version ${version}`);
