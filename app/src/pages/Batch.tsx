// Lotes de impresión — lista de jobs con progreso en vivo (SSE), estilo
// Spotify: badges de estado y barras de progreso verdes.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStudio } from "../store";
import type { Job } from "../types";
import { Icon } from "../components/Icon";

const STORE_KEY = "studio.jobIds";

function loadIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(ids.slice(0, 30)));
}

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "En cola",
  running: "Imprimiendo",
  done: "Completado",
  failed: "Con errores",
  cancelled: "Cancelado",
};

export function Batch() {
  const { refreshTick, trackJob, setPage } = useStudio();
  const [ids, setIds] = useState<string[]>(loadIds);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const subs = useRef<Map<string, () => void>>(new Map());

  const refresh = useCallback(async () => {
    const list = await Promise.all(ids.map((id) => api.job(id).catch(() => null)));
    const map: Record<string, Job> = {};
    list.forEach((j, i) => {
      if (j) map[ids[i]] = j;
    });
    setJobs(map);
  }, [ids]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  // Suscribirse a jobs activos
  useEffect(() => {
    for (const [id, job] of Object.entries(jobs)) {
      const active = job.status === "pending" || job.status === "running";
      if (active && !subs.current.has(id)) {
        const unsub = trackJob(id);
        // trackJob devuelve la unsub; la guardamos para no duplicar
        subs.current.set(id, () => unsub());
      }
    }
    // Los terminados: quitar suscripciones
    for (const [id, unsub] of subs.current) {
      if (!jobs[id] || !(jobs[id].status === "pending" || jobs[id].status === "running")) {
        unsub();
        subs.current.delete(id);
      }
    }
  }, [jobs, trackJob]);

  useEffect(() => () => subs.current.forEach((u) => u()), []);

  const cancel = async (id: string) => {
    await api.cancelJob(id);
    void refresh();
  };

  const clearFinished = () => {
    const next = ids.filter((id) => {
      const j = jobs[id];
      return !j || j.status === "pending" || j.status === "running";
    });
    setIds(next);
    saveIds(next);
  };

  const sorted = [...ids].sort((a, b) => {
    const ja = jobs[a];
    const jb = jobs[b];
    if (!ja || !jb) return 0;
    return new Date(jb.createdAt).getTime() - new Date(ja.createdAt).getTime();
  });

  return (
    <>
      <div className="hero">
        <h1>Lotes de impresión</h1>
        <p>Progreso en vivo de cada trabajo. Los lotes se imprimen en orden, uno tras otro.</p>
      </div>

      <div className="row mt">
        <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
          <Icon name="refresh" size={14} /> Refrescar
        </button>
        <button className="btn btn-ghost btn-sm" onClick={clearFinished} disabled={sorted.length === 0}>
          Limpiar terminados
        </button>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12.5 }}>
          {sorted.length} trabajos
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="big">🖨️</div>
          <h3>Sin trabajos todavía</h3>
          <p>Lanza un lote desde Importar o imprime una plantilla desde el diseñador.</p>
          <button className="btn btn-primary" onClick={() => setPage("import")}>
            Importar lote
          </button>
        </div>
      ) : (
        <div className="mt">
          {sorted.map((id) => {
            const job = jobs[id];
            if (!job) {
              return (
                <div className="job-card muted" key={id}>
                  Cargando {id}…
                </div>
              );
            }
            const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
            const active = job.status === "pending" || job.status === "running";
            return (
              <div className="job-card" key={id}>
                <div className="job-head">
                  <span className={`badge ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                  <span className="job-title">{job.label}</span>
                  {job.dryRun && <span className="badge pending">dry-run</span>}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {id}
                  </span>
                  {active && (
                    <button className="btn btn-ghost btn-sm" onClick={() => void cancel(id)}>
                      <Icon name="x" size={13} /> Cancelar
                    </button>
                  )}
                </div>
                <div className="progress">
                  <div
                    className={`progress-fill${job.failed > 0 ? " warn" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="job-meta">
                  <span>
                    {job.done}/{job.total} impresas
                  </span>
                  {job.failed > 0 && <span className="err-text">{job.failed} con error</span>}
                  {job.currentIndex !== null && job.status === "running" && (
                    <span>
                      Actual: #{job.currentIndex + 1}
                    </span>
                  )}
                  <span className="muted">
                    {new Date(job.createdAt).toLocaleString("es-ES")}
                  </span>
                  {job.finishedAt && <span className="muted">· {new Date(job.finishedAt).toLocaleTimeString("es-ES")}</span>}
                </div>
                {job.errors.length > 0 && (
                  <div className="job-errors">
                    {job.errors.map((e, i) => (
                      <div key={i}>
                        {e.index !== undefined ? `#${e.index + 1}: ` : ""}
                        {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
