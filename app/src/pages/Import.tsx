// Importar CSV/Excel → mapeo de columnas a {{variables}} → lote de impresión.

import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { api } from "../api";
import { useStudio } from "../store";
import type { ImportRow, TemplateSummary } from "../types";
import { Icon } from "../components/Icon";

type FileKind = "csv" | "xlsx" | null;
void (null as unknown as FileKind); // (tipo reservado para futura extensión)

export function Import() {
  const { trackJob, setPage, bumpRefresh } = useStudio();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [tplName, setTplName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [vars, setVars] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api
      .templates()
      .then((list) => {
        setTemplates(list);
        if (list.length > 0 && !tplName) setTplName(list[0].name);
      })
      .catch(() => undefined);
  }, []);

  // Variables de la plantilla elegida
  useEffect(() => {
    if (!tplName) {
      setVars([]);
      return;
    }
    api
      .getTemplate(tplName)
      .then((t) => {
        const found = new Set<string>();
        for (const el of t.elements) {
          if (el.type !== "text" || !el.content) continue;
          for (const m of el.content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) found.add(m[1]);
        }
        const list = [...found].sort();
        setVars(list);
        // Auto-mapeo por nombre de columna
        setMapping((prev) => {
          const next = { ...prev };
          for (const v of list) {
            if (!next[v]) {
              const hit = columns.find((c) => c.toLowerCase() === v.toLowerCase());
              if (hit) next[v] = hit;
            }
          }
          return next;
        });
      })
      .catch(() => setVars([]));
  }, [tplName, columns]);

  const parseFile = async (file: File) => {
    setErr(null);
    setFileName(file.name);
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: "" });
      finishParse(json);
    } else {
      Papa.parse<ImportRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          finishParse(res.data as ImportRow[]);
        },
        error: () => setErr("No se pudo leer el CSV"),
      });
    }
  };

  const finishParse = (data: ImportRow[]) => {
    if (data.length === 0) {
      setErr("El archivo no contiene filas de datos");
      setRows([]);
      setColumns([]);
      return;
    }
    setRows(data);
    const cols = Object.keys(data[0]);
    setColumns(cols);
  };

  const mappedColumns = useMemo(() => Object.values(mapping), [mapping]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const records = rows.map((r) => {
        const rec: Record<string, string | number> = {};
        for (const v of vars) rec[v] = mapping[v] ? r[mapping[v]] : "";
        return rec;
      });
      const res = await api.startBatch(tplName, records, dryRun);
      // Recordar el job en la lista persistente de la página Lotes
      const ids: string[] = JSON.parse(localStorage.getItem("studio.jobIds") ?? "[]");
      localStorage.setItem("studio.jobIds", JSON.stringify([res.jobId, ...ids].slice(0, 30)));
      trackJob(res.jobId);
      bumpRefresh();
      setPage("batch");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const progress = vars.length > 0 ? mappedColumns.filter(Boolean).length : null;

  return (
    <>
      <div className="hero">
        <h1>Importar etiquetas</h1>
        <p>Sube un CSV o Excel, asigna las columnas a las variables de la plantilla y lanza el lote.</p>
      </div>

      <div className="row mt" style={{ flexWrap: "wrap", gap: 14 }}>
        <div className="panel grow" style={{ minWidth: 280 }}>
          <div className="field">
            <label>Plantilla</label>
            <select value={tplName} onChange={(e) => setTplName(e.target.value)}>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            {vars.length > 0 && (
              <div className="field-hint">
                Variables:{" "}
                {vars.map((v) => (
                  <code key={v} className="mono" style={{ color: "var(--accent)" }}>
                    {"{{" + v + "}}"}
                  </code>
                )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, " ", el]), [])}
              </div>
            )}
          </div>
        </div>

        <div className="panel grow" style={{ minWidth: 280 }}>
          <div
            className={`file-drop${over ? " over" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void parseFile(f);
            }}
          >
            <div className="big">📁</div>
            <div>
              <strong>{fileName || "Arrastra tu CSV o Excel aquí"}</strong>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              o haz clic para elegir archivo · {rows.length > 0 ? `${rows.length} filas cargadas` : "CSV / XLSX"}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parseFile(f);
              }}
            />
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="section-title">Mapeo de columnas → variables</div>
          <div className="panel mt">
            {vars.length === 0 ? (
              <div className="muted">La plantilla no tiene variables. El lote imprimirá etiquetas idénticas.</div>
            ) : (
              <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
                {vars.map((v) => (
                  <div key={v} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
                      {"{{" + v + "}}"}
                    </label>
                    <select value={mapping[v] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [v]: e.target.value }))}>
                      <option value="">— sin asignar —</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="row mt" style={{ flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                Dry-run (no imprime, solo genera)
              </label>
              <div className="grow" />
              <button className="btn btn-primary" disabled={busy || rows.length === 0 || (progress !== null && progress < vars.length)} onClick={() => void start()}>
                <Icon name="play" size={15} /> Lanzar lote ({rows.length})
              </button>
            </div>
            {progress !== null && progress < vars.length && (
              <div className="field-hint mt" style={{ color: "var(--warning)" }}>
                Asigna todas las variables antes de lanzar el lote ({progress}/{vars.length} asignadas).
              </div>
            )}
          </div>

          <div className="section-title">Vista previa de datos ({rows.length} filas)</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c}>{String(r[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <div className="muted mt" style={{ fontSize: 12.5 }}>
              Mostrando las primeras 100 filas de {rows.length}.
            </div>
          )}
        </>
      )}

      {err && <div className="err-text mt">{err}</div>}
    </>
  );
}
