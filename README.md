# Label Printer Studio 🏷️

App de escritorio + web (estilo Spotify) para **diseñar etiquetas térmicas** e
**imprimir lotes** desde CSV/Excel. Construida con **Electron + Vite + React +
TypeScript** sobre el paquete [`label-printer-core`](https://www.npmjs.com/package/label-printer-core).

> La misma codebase corre como **webapp** (navegador) y como **app de escritorio**
> (Electron), igual que Spotify: una sola UI oscura con sidebar, cards y acento verde.

---

## ✨ Características

| | |
|---|---|
| 🎨 **Diseñador** | Canvas SVG fiel al renderer del core: texto, rectángulo, línea, círculo, rayas y rejilla. Variables `{{var}}`, auto-fit de texto, zoom, mover/redimensionar, guardar plantillas en el servidor |
| 📥 **Importar** | Sube **CSV o Excel** (papaparse + SheetJS), vista previa de filas, auto-mapeo de columnas a `{{variables}}` y lanzamiento de lotes |
| 🖨️ **Lotes** | Cola de impresión secuencial con **progreso en vivo (SSE)**, cancelación, errores por registro y barra "Now printing" estilo Spotify |
| 🔌 **Servidor integrado** | Express sirve la API **y** el build del app en un único puerto; CORS abierto para desarrollo |

## 🚀 Arranque rápido

```bash
# 1) Server (API + app web) — puerto 3456
cd server
npm install
npm start            # http://localhost:3456

# 2) App de escritorio (Electron)
cd app
npm install
npm run desktop      # build + ventana nativa

# 3) O solo web en desarrollo (hot reload en :5173, proxy a :3456)
cd app
npm run dev
```

## 🏗️ Estructura

```
label-printer-studio/
├── server/            # Express :3456 — API (health, printers, templates,
│                      #   print, batch+SSE) + sirve app/dist + /fonts
│   ├── src/index.js   #   rutas API y estáticos
│   ├── src/queue.js   #   cola de impresión secuencial con eventos
│   ├── config.json    #   impresora activa y dispositivo
│   └── templates/     #   plantillas JSON (formato de label-printer-core)
└── app/               # Electron + Vite + React + TS (UI estilo Spotify)
    ├── electron/      #   main.cjs + preload.cjs (wrapper de escritorio)
    └── src/
        ├── pages/     #   Inicio, Diseñador, Importar, Lotes, Ajustes
        ├── designer/  #   renderSvg.tsx — preview fiel a render.mjs del core
        ├── components/#   Sidebar, Topbar, NowPlaying, Icon
        ├── api.ts     #   cliente del server (REST + SSE)
        └── theme.css  #   tema oscuro estilo Spotify
```

## 📦 Dependencias clave

- `label-printer-core` — renderizado e impresión real (perfiles de impresora JSON)
- `express` — API del servidor
- `react` / `vite` / `typescript` — frontend
- `electron` — app de escritorio
- `papaparse` + `xlsx` — importación de datos

## 🖨️ Imprimir

El server usa la impresora configurada en `server/config.json` (perfil, medio y
dispositivo). Ejemplo:

```bash
# Dry-run (genera sin imprimir)
curl -X POST localhost:3456/api/print \
  -H 'Content-Type: application/json' \
  -d '{"template":"backups-term-vt323","variables":{"line1":"BACKUPS","line2":"USB STORAGE"},"dryRun":true}'

# Lote (cola secuencial)
curl -X POST localhost:3456/api/batch \
  -H 'Content-Type: application/json' \
  -d '{"template":"backups-term-vt323","records":[{"line1":"A","line2":"1"},{"line1":"B","line2":"2"}]}'
```

## 📄 Licencia

MIT
