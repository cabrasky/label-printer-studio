// Ajustes — URL del servidor, estado de conexión e información del sistema.

import { useState } from "react";
import { api, setBase } from "../api";
import { useStudio } from "../store";
import { Icon } from "../components/Icon";

export function Settings() {
  const { health, connected, checking, checkHealth, bumpRefresh } = useStudio();
  const [url, setUrl] = useState(api.base());
  const [saved, setSaved] = useState(false);

  const saveUrl = async () => {
    setBase(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    await checkHealth();
    bumpRefresh();
  };

  const platform = (window as unknown as { studio?: { platform: string; versions: Record<string, string> } }).studio;

  return (
    <>
      <div className="hero">
        <h1>Ajustes</h1>
        <p>Configura la conexión con el servidor de impresión.</p>
      </div>

      <div className="row mt" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div className="panel grow" style={{ minWidth: 320 }}>
          <div className="field">
            <label>URL del servidor</label>
            <input
              type="text"
              value={url}
              placeholder="http://192.168.1.12:3456"
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <div className="field-hint">
              El servidor Express sirve la API y esta misma app. Vacío = mismo origen
              (localhost:3456 en la app de escritorio).
            </div>
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void saveUrl()}>
              <Icon name="save" size={14} /> Guardar y probar
            </button>
            {saved && <span className="ok-text">Guardado</span>}
          </div>

          <div className="panel" style={{ marginTop: 16, background: "var(--bg-highlight)" }}>
            <div className="row">
              <span className={`conn-dot ${checking ? "" : connected ? "on" : "off"}`} style={{ width: 12, height: 12 }} />
              <strong>{checking ? "Comprobando conexión…" : connected ? "Conectado al servidor" : "Servidor no accesible"}</strong>
            </div>
            {health && (
              <div className="muted mt" style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>
                  Servidor: <span className="mono">{health.server}</span>
                </div>
                <div>
                  Impresora: <strong>{health.printer.name}</strong> ({health.printer.id})
                </div>
                <div>
                  Medio: <span className="mono">{health.printer.media}</span> · Dispositivo:{" "}
                  <span className="mono">{health.printer.device ?? "sin dispositivo"}</span>
                </div>
              </div>
            )}
            {!health && (
              <div className="err-text mt">
                Comprueba que el server está arrancado (npm start en server/) y que la URL es correcta.
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ minWidth: 260 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>
            Información
          </h3>
          <table style={{ fontSize: 13 }}>
            <tbody>
              <tr>
                <td className="muted">Modo</td>
                <td>{platform ? `Escritorio (${platform.platform})` : "Navegador (web)"}</td>
              </tr>
              <tr>
                <td className="muted">App</td>
                <td>label-printer-studio v0.2.0</td>
              </tr>
              <tr>
                <td className="muted">Core</td>
                <td>label-printer-core (npm)</td>
              </tr>
              {platform && (
                <>
                  <tr>
                    <td className="muted">Electron</td>
                    <td className="mono">{platform.versions.electron}</td>
                  </tr>
                  <tr>
                    <td className="muted">Chromium</td>
                    <td className="mono">{platform.versions.chrome}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
