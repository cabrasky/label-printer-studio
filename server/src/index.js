import express from "express";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, registerFont } from "canvas";
import { printJob } from "label-printer-core/print";
import { loadProfile } from "label-printer-core/protocol";
import { PrintQueue } from "./queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(SERVER_ROOT, "templates");
const CONFIG_PATH = path.join(SERVER_ROOT, "config.json");
const FONT_DIR = path.join(SERVER_ROOT, "fonts");
const require = createRequire(import.meta.url);
// Ruta a los perfiles del paquete: resolver "label-printer-core/protocol" (exportado)
// y subir un nivel -> raíz del paquete -> printers/
// (import.meta.resolve usa la condición "import" del exports; require.resolve es CJS y falla)
const PKG_PRINTERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.resolve("label-printer-core/protocol"))), "printers");

// --- Fuentes de etiquetas (copia local en server/fonts) ---------------------
// canvas v3 (Skia) en Windows no resuelve de forma fiable las fuentes del
// paquete npm; registrarlas aquí con rutas absolutas garantiza el mismo
// resultado en todas las plataformas. Mismo mapeo que fonts.mjs del core.
const LABEL_FONTS = [
  ["Norwester Condensed", "norwester.ttf", "normal"],
  ["VT323", "VT323-Regular.ttf", "normal"],
  ["Share Tech Mono", "ShareTechMono-Regular.ttf", "normal"],
  ["Audiowide", "Audiowide-Regular.ttf", "normal"],
  ["Rajdhani", "Rajdhani-Bold.ttf", "normal"],
  ["Saira Stencil One", "SairaStencilOne-Regular.ttf", "normal"],
  ["Stardos Stencil", "StardosStencil-Bold.ttf", "normal"],
];
for (const [family, file, weight] of LABEL_FONTS) {
  try {
    registerFont(path.join(FONT_DIR, file), { family, weight });
    console.log(`[fonts] ${family} (${file})`);
  } catch (e) {
    console.warn(`[fonts] NO registrada ${family}: ${e.message}`);
  }
}

// canvas v3 (Skia/DirectWrite) en Windows NO resuelve las fuentes registradas
// con registerFont al renderizar (fallback a Sans). La solución fiable es
// instalarlas como fuentes del sistema del usuario: se copian a
// %LOCALAPPDATA%\Microsoft\Windows\Fonts y se registran en HKCU — sin
// elevación. Al reiniciar el server, DirectWrite las resuelve por nombre.
function ensureWindowsFonts() {
  if (process.platform !== "win32") return;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;
  const fontsUserDir = path.join(localAppData, "Microsoft", "Windows", "Fonts");
  const regKey = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
  for (const [family, file] of LABEL_FONTS) {
    try {
      mkdirSync(fontsUserDir, { recursive: true });
      copyFileSync(path.join(FONT_DIR, file), path.join(fontsUserDir, file));
      execFileSync("reg", ["add", regKey, "/v", `${family} (TrueType)`, "/t", "REG_SZ", "/d", file, "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      console.log(`[fonts] ${family} instalada como fuente de usuario (${file})`);
    } catch (e) {
      console.warn(`[fonts] no se pudo instalar ${family}: ${e.message}`);
    }
  }
}
ensureWindowsFonts();

const app = express();
const queue = new PrintQueue();
const PORT = process.env.PORT || 3456;

app.use(express.json({ limit: "2mb" }));

// CORS abierto (app móvil / desarrollo)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Utilidades ---------------------------------------------------------------
function loadTemplate(nameOrObj) {
  if (typeof nameOrObj !== "string") return nameOrObj;
  const safe = nameOrObj.replace(/[^a-zA-Z0-9_-]/g, "");
  const file = path.join(TEMPLATES_DIR, `${safe}.json`);
  if (!existsSync(file)) {
    const err = new Error(`Plantilla "${nameOrObj}" no encontrada`);
    err.status = 404;
    throw err;
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function listProfiles() {
  return readdirSync(PKG_PRINTERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = JSON.parse(readFileSync(path.join(PKG_PRINTERS_DIR, f), "utf8"));
      return {
        id: raw.id,
        name: raw.name,
        aliases: raw.aliases ?? [],
        usb: raw.usb ?? {},
        dpi: raw.dpi,
        media: raw.media,
        limits: raw.limits,
      };
    });
}

// Verifica que cada fuente de etiqueta se aplica de verdad (si una fuente no
// se resuelve, mide igual que sans-serif — el pitfall clásico de node-canvas).
function fontStatus() {
  const c = createCanvas(200, 40);
  const ctx = c.getContext("2d");
  const out = {};
  for (const [family] of LABEL_FONTS) {
    ctx.font = `28px "${family}"`;
    const w = ctx.measureText("TEST").width;
    ctx.font = "28px sans-serif";
    const wSans = ctx.measureText("TEST").width;
    out[family] = { loaded: Math.abs(w - wSans) > 1, width: Math.round(w) };
  }
  return out;
}

// Lista los dispositivos de impresión disponibles según la plataforma.
function listDevices() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // Puertos COM + impresoras instaladas vía PowerShell (rápido, sin deps)
      const script =
        "$ports = [System.IO.Ports.SerialPort]::GetPortNames(); " +
        "$printers = Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name; " +
        "Write-Output ('PORTS:' + ($ports -join ',')); " +
        "Write-Output ('PRINTERS:' + ($printers -join ','))";
      execFile("powershell", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        const ports = [];
        const printers = [];
        for (const line of (stdout ?? "").split(/\r?\n/)) {
          const t = line.trim();
          if (t.startsWith("PORTS:")) ports.push(...t.slice(6).split(",").filter(Boolean));
          if (t.startsWith("PRINTERS:")) printers.push(...t.slice(9).split(",").filter(Boolean));
        }
        resolve({ devices: [...new Set(ports)], printers: [...new Set(printers)], platform: process.platform });
      });
    } else {
      const candidates = [
        "/dev/usb/lp0", "/dev/usb/lp1", "/dev/usb/lp2",
        "/dev/ttyUSB0", "/dev/ttyUSB1",
        "/dev/ttyACM0", "/dev/ttyACM1",
      ];
      resolve({ devices: candidates.filter((d) => existsSync(d)), printers: [], platform: process.platform });
    }
  });
}

function currentDevice(cfg) {
  return process.env.PRINTER_DEVICE ?? cfg.device ?? null;
}

// --- API ----------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const profile = loadProfile(cfg.printer);
  const device =
    process.env.PRINTER_DEVICE ?? cfg.device ?? profile.connection.defaultDevice[process.platform] ?? null;
  res.json({
    ok: true,
    server: "label-printer-studio",
    printer: { id: profile.id, name: profile.name, device, media: cfg.media?.type ?? profile.media.defaultType },
  });
});

app.get("/api/printers", (req, res) => {
  res.json(listProfiles());
});

app.get("/api/fonts", (req, res) => {
  res.json(fontStatus());
});

app.get("/api/devices", async (req, res) => {
  const { devices, printers, platform } = await listDevices();
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  res.json({ devices, printers, current: currentDevice(cfg), platform });
});

app.post("/api/device", (req, res) => {
  const { device } = req.body ?? {};
  const value = typeof device === "string" ? device.trim() : "";
  // Solo rutas de dispositivo reales: COMx (Windows) o /dev/... (Linux).
  // Sin ".." ni caracteres raros: el valor se usa para abrir el dispositivo.
  if (value !== "" && !/^(COM\d+|\/dev\/[A-Za-z0-9_/-]+)$/.test(value)) {
    return res.status(400).json({ error: "Dispositivo inválido (usa p.ej. COM3, /dev/usb/lp0)" });
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  cfg.device = value || null; // "" o null -> automático (default del perfil)
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  res.json({ ok: true, device: cfg.device });
});

app.get("/api/templates", (req, res) => {
  const items = readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const t = JSON.parse(readFileSync(path.join(TEMPLATES_DIR, f), "utf8"));
      return { name: f.replace(/\.json$/, ""), description: t.description ?? "", dimensions: t.dimensions ?? null };
    });
  res.json(items);
});

app.get("/api/templates/:name", (req, res) => {
  try {
    res.json(loadTemplate(req.params.name));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

app.post("/api/templates", (req, res) => {
  const { name, template } = req.body ?? {};
  const safe = String(name ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || !template || typeof template !== "object") {
    return res.status(400).json({ error: "Se requiere {name, template}" });
  }
  const file = path.join(TEMPLATES_DIR, `${safe}.json`);
  writeFileSync(file, JSON.stringify(template, null, 2));
  res.json({ ok: true, name: safe });
});

app.post("/api/print", async (req, res) => {
  const { template, variables = {}, dryRun = false } = req.body ?? {};
  try {
    const tpl = loadTemplate(template);
    const result = await printJob({ template: tpl, variables, dryRun: !!dryRun, configPath: CONFIG_PATH });
    res.json({ ok: true, bytes: result.bytes, mediaType: result.mediaType, device: result.device, dryRun: result.dryRun });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/batch", (req, res) => {
  const { template, records, dryRun = false } = req.body ?? {};
  try {
    const tpl = loadTemplate(template);
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "Se requiere records: array de objetos de variables" });
    }
    const tplName = typeof template === "string" ? template : tpl.name ?? "inline";
    const jobId = queue.enqueue(
      tplName,
      records,
      (record) => printJob({ template: tpl, variables: record, dryRun: !!dryRun, configPath: CONFIG_PATH }),
      { dryRun: !!dryRun }
    );
    res.json({ ok: true, jobId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/batch/:id", (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job no encontrado" });
  res.json(job);
});

app.post("/api/batch/:id/cancel", (req, res) => {
  res.json({ ok: queue.cancel(req.params.id) });
});

// SSE — progreso en vivo
app.get("/api/batch/:id/events", (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job no encontrado" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send(job);

  const unsubscribe = queue.subscribe(req.params.id, send);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// --- App web + fuentes ------------------------------------------------------
// Fuentes de etiquetas del paquete label-printer-core (preview del diseñador)
try {
  const pkgRoot = path.dirname(fileURLToPath(import.meta.resolve("label-printer-core/protocol")));
  const fontsDir = path.join(pkgRoot, "fonts");
  if (existsSync(fontsDir)) app.use("/fonts", express.static(fontsDir));
} catch (e) {
  console.warn("[printer-studio] fuentes del core no disponibles:", e.message);
}

// Build de Vite (app/) servido por el mismo puerto — así la app de escritorio
// y la web apuntan a un único endpoint.
const APP_DIST = path.join(SERVER_ROOT, "..", "app", "dist");
if (existsSync(APP_DIST)) {
  app.use(express.static(APP_DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(APP_DIST, "index.html")));
  console.log(`[printer-studio] app web: ${APP_DIST}`);
}

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`[printer-studio] API en http://0.0.0.0:${PORT}`);
  console.log(`[printer-studio] plantillas: ${TEMPLATES_DIR}`);
  console.log(`[printer-studio] perfiles: ${PKG_PRINTERS_DIR}`);
});
