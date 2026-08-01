// Smoke test del server (corre en CI: ubuntu + windows).
// Arranca src/index.js en un puerto de test, comprueba health, fuentes y un
// print dry-run, y termina. No necesita impresora.
//
//   node test/smoke.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (out += d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (out.includes("API en http")) return;
    if (child.exitCode !== null) throw new Error(`server murió: ${out.slice(-500)}`);
    await sleep(250);
  }
  throw new Error(`timeout esperando al server. Salida: ${out.slice(-500)}`);
}

try {
  await waitReady();

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error(`health no ok: ${JSON.stringify(health)}`);

  const fonts = await (await fetch(`${BASE}/api/fonts`)).json();
  const fontNames = Object.keys(fonts);
  if (fontNames.length < 7) throw new Error(`faltan fuentes: ${fontNames.join(",")}`);

  const print = await (
    await fetch(`${BASE}/api/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "backups-term-vt323",
        variables: { line1: "BACKUPS", line2: "USB STORAGE" },
        dryRun: true,
      }),
    })
  ).json();
  if (!print.ok || print.bytes !== 3882) {
    throw new Error(`print dry-run inesperado: ${JSON.stringify(print)}`);
  }

  console.log(`✓ health: ${health.server} | impresora: ${health.printer.name} (${health.printer.media})`);
  console.log(`✓ fuentes registradas: ${fontNames.join(", ")}`);
  console.log(`✓ print dry-run: ${print.bytes} bytes (${print.mediaType})`);
  console.log(`SMOKE OK (${process.platform})`);
} finally {
  child.kill();
}
