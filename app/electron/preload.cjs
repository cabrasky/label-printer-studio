// Puente mínimo de seguridad: expone versión de la app al renderer.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
