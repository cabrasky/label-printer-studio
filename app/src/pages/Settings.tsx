// Ajustes — URL del servidor, dispositivo de impresión, fuentes y estado.

import { useEffect, useState } from "react";
import { api, setBase } from "../api";
import { useStudio } from "../store";
import { Icon } from "../components/Icon";

export function Settings() {
  const { health, connected, checking, checkHealth, bumpRefresh } = useStudio();
  const [url, setUrl] = useState(api.base());
  const [saved, setSaved] = useState(false);

  // Dispositivo de impresión
  const [devices, setDevices] = useState<string[]>([]);
  const [platform, setPlatform] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<string>("");
  const [deviceMsg, setDeviceMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Estado de fuentes
  const [fonts, setFonts] = useState<Record<string, { loaded: boolean; width: number }> | null>(null);

  const loadDevices = async () => {
    try {
      const d = await api.devices();
      setDevices(d.devices);
      setPlatform(d.platform);
      setCurrent(d.current);
      setDeviceDraft(d.current ?? "");
    } catch {
      /* server offline */
    }
  };

  useEffect(() => {
    void loadDevices();
    api
      .fonts()
      .then(setFonts)
      .catch(() => setFonts(null));
  }, []);

  const saveUrl = async () => {
    setBase(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    await checkHealth();
    bumpRefresh();
  };

  const applyDevice = async () => {
    setDeviceMsg(null);
    try {
      const res = await api.setDevice(deviceDraft);
      setCurrent(res.device);
      setDeviceMsg({
        kind: "ok",
        text: res.device ? `Dispositivo guardado: ${res.device}` : "Automático (default del perfil)",
      });
      await checkHealth();
      bumpRefresh();
    } catch (e) {
      setDeviceMsg({ kind: "err", text: (e as Error).message });
    }
  };

  const desktopInfo = (window as unknown as { studio?: { platform: string; versions: Record<string, string> } }).studio;
  const fontList = fonts ? Object.entries(fonts) : [];

  return (
    <>
      <div className="hero">
        <h1>Ajustes</h1>
        <p>Configura la conexión con el servidor de impresión.</p>
      </div>

      <div className="row mt" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: "1 1 380px", minWidth: 320 }}>
          <div className="panel">
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
                El servidor Express sirve la API y esta misma app. Vacío = mismo origen.
              </div>
            </div>
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={() => void saveUrl()}>
                <Icon name="save" size={14} /> Guardar y probar
              </button>
              {saved && <span className="ok-text">Guardado</span>}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>
              Dispositivo de impresión
            </h3>
            <div className="field">
              <label>Dispositivo ({platform === "win32" ? "Windows · puertos COM" : "Linux · USB/serie"})</label>
              <div className="row" style={{ gap: 8 }}>
                <select
                  value={deviceDraft}
                  onChange={(e) => setDeviceDraft(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">Automático (default del perfil)</option>
                  {devices.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {current && !devices.includes(current) && (
                    <option value={current}>{current} (actual)</option>
                  )}
                </select>
                <button className="btn btn-primary btn-sm" onClick={() => void applyDevice()} disabled={deviceDraft === (current ?? "")}>
                  <Icon name="save" size={14} /> Aplicar
                </button>
              </div>
              <div className="field-hint">
                Actual: <span className="mono">{current ?? "automático (default)"}</span>
                {devices.length === 0 && " · ningún dispositivo detectado — comprueba cables/drivers"}
              </div>
            </div>
            {deviceMsg && <div className={deviceMsg.kind === "ok" ? "ok-text" : "err-text"}>{deviceMsg.text}</div>}
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>
              Estado de conexión
            </h3>
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

          <div className="panel" style={{ marginTop: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>
              Fuentes de etiquetas
            </h3>
            {fontList.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No se pudo consultar el estado de fuentes (servidor offline).
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
                {fontList.map(([family, f]) => (
                  <div
                    key={family}
                    className="row"
                    style={{ gap: 8, background: "var(--bg-highlight)", borderRadius: 6, padding: "7px 10px", fontSize: 12.5 }}
                  >
                    <span className={`conn-dot ${f.loaded ? "on" : "off"}`} style={{ width: 8, height: 8 }} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{family}</span>
                    <span className="muted mono" style={{ marginLeft: "auto" }}>{f.width}px</span>
                  </div>
                ))}
              </div>
            )}
            <div className="field-hint mt">
              Punto verde = la fuente se aplica de verdad (si falla, mide igual que sans-serif).
            </div>
          </div>
        </div>

        <div className="panel" style={{ flex: "1 1 260px", minWidth: 260 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>
            Información
          </h3>
          <table style={{ fontSize: 13 }}>
            <tbody>
              <tr>
                <td className="muted">Modo</td>
                <td>{desktopInfo ? `Escritorio (${desktopInfo.platform})` : "Navegador (web)"}</td>
              </tr>
              <tr>
                <td className="muted">App</td>
                <td>label-printer-studio v0.2.0</td>
              </tr>
              <tr>
                <td className="muted">Core</td>
                <td>label-printer-core (npm)</td>
              </tr>
              {desktopInfo && (
                <>
                  <tr>
                    <td className="muted">Electron</td>
                    <td className="mono">{desktopInfo.versions.electron}</td>
                  </tr>
                  <tr>
                    <td className="muted">Chromium</td>
                    <td className="mono">{desktopInfo.versions.chrome}</td>
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
