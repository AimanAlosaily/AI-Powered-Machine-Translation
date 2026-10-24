// Verta for Windows. Serves the bundled app (including both translation
// models) from 127.0.0.1 and shows it in a locked-down window. Requests to any
// other host are blocked, so documents and translations never leave the
// computer, and no internet connection is ever needed.
import { app, BrowserWindow, Menu, session, shell } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = app.isPackaged
  ? join(process.resourcesPath, "web")
  : join(dirname(fileURLToPath(import.meta.url)), "web");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

async function findFile(pathname) {
  const file = resolve(WEB_ROOT, `.${pathname}`);
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + sep)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return { file, size: info.size };
    if (info.isDirectory()) {
      const index = join(file, "index.html");
      const indexInfo = await stat(index);
      return { file: index, size: indexInfo.size };
    }
  } catch {
    // Missing file: fall through to 404.
  }
  return null;
}

function startServer() {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const found = await findFile(pathname);
    if (!found) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": TYPES[extname(found.file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": found.size,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(found.file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    // Loopback only: nothing on the network can reach this server.
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

function lockDown(origin) {
  const allowed = (url) =>
    url.startsWith(`${origin}/`) || url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("devtools:");
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowed(details.url) });
  });
  // Only clipboard writes (the Copy button) are permitted.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
}

function createWindow(origin) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: "Verta",
    backgroundColor: "#f3f0e7",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  const openOutside = (url) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${origin}/`)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  void window.loadURL(`${origin}/`);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow;
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const server = await startServer();
    const origin = `http://127.0.0.1:${server.address().port}`;
    lockDown(origin);
    mainWindow = createWindow(origin);
  });
}
