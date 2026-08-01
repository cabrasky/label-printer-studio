// Captura de pantalla de la ventana (útil para verificar el desktop build
// en headless y para el README). Uso: xvfb-run -a npx electron electron/screenshot.cjs
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const OUT = process.argv[2] || path.join(__dirname, "..", "screenshot.png");
const URL = process.env.APP_URL || "http://localhost:3456";

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: "#121212",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(URL);
  // Esperar a que carguen fuentes y render
  await new Promise((r) => setTimeout(r, 2500));
  // Si se pide el diseñador, navegar (igual que haría el usuario)
  if (process.env.SHOT_PAGE === "designer") {
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim() === 'Diseñador')?.click(); true`
    );
    await new Promise((r) => setTimeout(r, 1500));
  }
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log(`screenshot → ${OUT} (${img.getSize().width}x${img.getSize().height})`);
  app.quit();
});
