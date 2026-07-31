import { useEffect, useState } from "react";
import { api } from "../api";
import { useStudio } from "../store";
import type { Page } from "../store";
import type { TemplateSummary } from "../types";
import { Icon } from "./Icon";

const NAV: Array<{ page: Page; icon: string; label: string }> = [
  { page: "home", icon: "home", label: "Inicio" },
  { page: "designer", icon: "edit", label: "Diseñador" },
  { page: "import", icon: "upload", label: "Importar" },
  { page: "batch", icon: "printer", label: "Lotes" },
  { page: "settings", icon: "settings", label: "Ajustes" },
];

export function Sidebar() {
  const { page, setPage } = useStudio();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    api
      .templates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [page]);

  const openTemplate = (name: string) => {
    // Se pasa el nombre vía sessionStorage para que el diseñador lo cargue
    sessionStorage.setItem("studio.designerTemplate", name);
    setPage("designer");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="badge">🏷️</span>
        <span>Label Studio</span>
      </div>

      {NAV.map((n) => (
        <button
          key={n.page}
          className={`nav-item${page === n.page ? " active" : ""}`}
          onClick={() => setPage(n.page)}
        >
          <span className="nav-icon">
            <Icon name={n.icon} size={17} />
          </span>
          <span>{n.label}</span>
        </button>
      ))}

      <div className="sidebar-section">Tus plantillas</div>
      {templates.map((t) => (
        <button key={t.name} className="tpl-item" onClick={() => openTemplate(t.name)}>
          <span className="cover">🏷️</span>
          <span className="meta">
            <span>{t.name}</span>
            <span className="sub">
              {t.dimensions ? `${t.dimensions.width}×${t.dimensions.height}` : "—"}
            </span>
          </span>
        </button>
      ))}
      {templates.length === 0 && <div className="muted" style={{ padding: "0 12px", fontSize: 12 }}>Sin plantillas aún</div>}
    </aside>
  );
}

const TITLES: Record<Page, string> = {
  home: "Inicio",
  designer: "Diseñador",
  import: "Importar etiquetas",
  batch: "Lotes de impresión",
  settings: "Ajustes",
};

export function Topbar() {
  const { page, connected, checking, health, checkHealth } = useStudio();
  return (
    <header className="topbar">
      <div className="row" style={{ gap: 8 }}>
        <button className="icon-btn" disabled title="Atrás" onClick={() => history.back()}>
          <Icon name="back" size={15} />
        </button>
        <button className="icon-btn" disabled title="Adelante" onClick={() => history.forward()}>
          <Icon name="forward" size={15} />
        </button>
      </div>
      <div className="topbar-title">{TITLES[page]}</div>
      <button className="icon-btn" title="Comprobar conexión" onClick={() => void checkHealth()}>
        <Icon name="refresh" size={15} />
      </button>
      <div className="conn-pill" title={health ? `${health.server} — ${health.printer.name} en ${health.printer.device ?? "sin dispositivo"}` : "Sin conexión"}>
        <span className={`conn-dot ${checking ? "" : connected ? "on" : "off"}`} />
        {checking ? "Comprobando…" : connected ? `${health!.printer.name} · ${health!.printer.media}` : "Servidor offline"}
      </div>
    </header>
  );
}

export function NowPlaying() {
  const { nowPlaying } = useStudio();
  if (!nowPlaying) return null;
  const pct = nowPlaying.total > 0 ? Math.round((nowPlaying.done / nowPlaying.total) * 100) : 0;
  return (
    <footer className="now-playing">
      <span className="cover">🖨️</span>
      <div className="info">
        <div className="name">{nowPlaying.label}</div>
        <div className="sub">
          {nowPlaying.status === "running" && nowPlaying.currentIndex !== null
            ? `Imprimiendo ${nowPlaying.currentIndex + 1} de ${nowPlaying.total}${nowPlaying.dryRun ? " (dry-run)" : ""}`
            : `${nowPlaying.done}/${nowPlaying.total} · ${nowPlaying.status}`}
        </div>
      </div>
      <div className="progress">
        <div className={`progress-fill${nowPlaying.failed > 0 ? " warn" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mono muted" style={{ fontSize: 12, width: 44, textAlign: "right" }}>
        {pct}%
      </div>
    </footer>
  );
}
