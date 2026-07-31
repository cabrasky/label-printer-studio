// Wrapper de escritorio (Electron) — ventana nativa estilo Spotify.
// La app la sirve el server Express (http://localhost:3456): misma URL para
// la web y el escritorio, con la API en el mismo origen.
const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const DEFAULT_URL = "http://localhost:3456";
const APP_URL = process.env.APP_URL || DEFAULT_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#121212",
    title: "Label Printer Studio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // Enlaces externos fuera de la ventana
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
