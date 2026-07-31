// Inicio — hero, estado de la impresora y grid de plantillas estilo Spotify.

import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "../api";
import { useStudio } from "../store";
import type { TemplateSummary } from "../types";
import { renderLabelSvg } from "../designer/renderSvg";
import { Icon } from "../components/Icon";

export function Home() {
  const { health, setPage, connected } = useStudio();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .templates()
      .then(async (list) => {
        setTemplates(list);
        // Preview SVG de cada plantilla (inline) para las cards
        const map: Record<string, string> = {};
        for (const t of list.slice(0, 12)) {
          try {
            const tpl = await api.getTemplate(t.name);
            const svg = renderLabelSvg(tpl);
            map[t.name] = renderToStaticMarkup(svg);
          } catch {
            /* sin preview */
          }
        }
        setCovers(map);
      })
      .catch(() => setTemplates([]));
  }, []);

  const openDesigner = (name: string) => {
    sessionStorage.setItem("studio.designerTemplate", name);
    setPage("designer");
  };

  return (
    <>
      <div className="hero">
        <h1>Buenas 👋</h1>
        <p>
          {connected
            ? `Impresora ${health!.printer.name} lista (${health!.printer.media}, ${health!.printer.device ?? "sin dispositivo"}).`
            : "Conecta el servidor en Ajustes para imprimir."}
        </p>
      </div>

      <div className="row mt" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => setPage("designer")}>
          <Icon name="edit" size={16} /> Crear etiqueta
        </button>
        <button className="btn btn-ghost" onClick={() => setPage("import")}>
          <Icon name="upload" size={16} /> Importar lote
        </button>
        <button className="btn btn-ghost" onClick={() => setPage("batch")}>
          <Icon name="printer" size={16} /> Ver lotes
        </button>
      </div>

      <div className="section-title">Tus plantillas</div>
      {templates.length === 0 ? (
        <div className="empty">
          <div className="big">🏷️</div>
          <h3>Sin plantillas todavía</h3>
          <p>Crea tu primera etiqueta en el diseñador o importa un CSV/Excel con un lote de impresión.</p>
          <button className="btn btn-primary" onClick={() => setPage("designer")}>
            Abrir el diseñador
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {templates.map((t) => (
            <button key={t.name} className="card" onClick={() => openDesigner(t.name)}>
              <div className="card-cover">
                {covers[t.name] ? (
                  <div dangerouslySetInnerHTML={{ __html: covers[t.name] }} />
                ) : (
                  <span style={{ fontSize: 30 }}>🏷️</span>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="card-title">{t.name}</div>
                <div className="card-sub">{t.description || "—"}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="section-title">Accesos rápidos</div>
      <div className="card-grid">
        <button className="card" onClick={() => setPage("import")}>
          <div className="card-cover" style={{ background: "linear-gradient(135deg,#1db954,#0d5c2b)" }}>
            <Icon name="upload" size={34} />
          </div>
          <div>
            <div className="card-title">Importar CSV / Excel</div>
            <div className="card-sub">Lote de etiquetas desde un archivo de datos.</div>
          </div>
        </button>
        <button className="card" onClick={() => setPage("batch")}>
          <div className="card-cover" style={{ background: "linear-gradient(135deg,#3d3d3d,#000)" }}>
            <Icon name="printer" size={34} />
          </div>
          <div>
            <div className="card-title">Lotes de impresión</div>
            <div className="card-sub">Progreso en vivo de los trabajos de impresión.</div>
          </div>
        </button>
        <button className="card" onClick={() => setPage("settings")}>
          <div className="card-cover" style={{ background: "linear-gradient(135deg,#1e3a8a,#0f172a)" }}>
            <Icon name="settings" size={34} />
          </div>
          <div>
            <div className="card-title">Ajustes</div>
            <div className="card-sub">Servidor, conexión e información del sistema.</div>
          </div>
        </button>
      </div>
    </>
  );
}
