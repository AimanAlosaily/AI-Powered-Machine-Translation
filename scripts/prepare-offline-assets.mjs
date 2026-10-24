import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(projectRoot, "public", "offline");
const fromRoot = (...parts) => join(projectRoot, "node_modules", ...parts);

await mkdir(join(destination, "tesseract-core"), { recursive: true });

const tesseractCore = fromRoot(
  ".pnpm",
  "tesseract.js-core@7.0.0",
  "node_modules",
  "tesseract.js-core",
);

const assets = [
  ...["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"].map((filename) => [
    fromRoot("@huggingface", "transformers", "dist", filename),
    join(destination, filename),
  ]),
  [
    fromRoot("pdfjs-dist", "build", "pdf.worker.min.mjs"),
    join(destination, "pdf.worker.min.mjs"),
  ],
  [
    fromRoot("tesseract.js", "dist", "worker.min.js"),
    join(destination, "worker.min.js"),
  ],
  // tesseract.js picks the fastest engine build the browser supports,
  // including the relaxed-SIMD builds that current Chrome and Edge use, so
  // copy every build rather than a fixed list.
  ...(await readdir(tesseractCore))
    .filter((filename) => /^tesseract-core.*\.wasm\.js$/.test(filename))
    .map((filename) => [
      join(tesseractCore, filename),
      join(destination, "tesseract-core", filename),
    ]),
  [
    fromRoot(
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
      "eng.traineddata.gz",
    ),
    join(destination, "eng.traineddata.gz"),
  ],
  [
    fromRoot(
      "@tesseract.js-data",
      "ara",
      "4.0.0_best_int",
      "ara.traineddata.gz",
    ),
    join(destination, "ara.traineddata.gz"),
  ],
];

for (const [source, target] of assets) {
  await cp(source, target);
}

// Use the same standalone worker with both Vite/Vinext and Next static export.
// Runtime and WASM live beside it, so no runtime CDN is needed after setup.
await build({
  entryPoints: [join(projectRoot, "app", "local-translation", "worker.ts")],
  outfile: join(destination, "translation-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "linked",
});

const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function distanceToSegment(x, y, startX, startY, endX, endY) {
  const width = endX - startX;
  const height = endY - startY;
  const lengthSquared = width * width + height * height;
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((x - startX) * width + (y - startY) * height) / lengthSquared,
    ),
  );
  const nearestX = startX + amount * width;
  const nearestY = startY + amount * height;
  return Math.hypot(x - nearestX, y - nearestY);
}

function createIcon(size) {
  const scanlines = Buffer.alloc(size * (1 + size * 4));
  const ink = [23, 32, 27, 255];
  const paper = [243, 240, 231, 255];
  const coral = [238, 107, 77, 255];
  const thickness = size * 0.065;

  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 4);
    scanlines[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const normalizedX = x / size;
      const normalizedY = y / size;
      const onV =
        distanceToSegment(
          normalizedX,
          normalizedY,
          0.27,
          0.28,
          0.5,
          0.72,
        ) <=
          thickness / size ||
        distanceToSegment(
          normalizedX,
          normalizedY,
          0.5,
          0.72,
          0.73,
          0.28,
        ) <=
          thickness / size;
      const onAccent =
        normalizedY > 0.79 &&
        normalizedY < 0.84 &&
        normalizedX > 0.3 &&
        normalizedX < 0.7;
      const color = onAccent ? coral : onV ? paper : ink;
      const offset = row + 1 + x * 4;
      scanlines[offset] = color[0];
      scanlines[offset + 1] = color[1];
      scanlines[offset + 2] = color[2];
      scanlines[offset + 3] = color[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

await Promise.all([
  writeFile(join(projectRoot, "public", "icon-192.png"), createIcon(192)),
  writeFile(join(projectRoot, "public", "icon-512.png"), createIcon(512)),
]);
