// Diseñador de etiquetas: canvas interactivo con preview SVG fiel al core,
// herramientas de dibujo, panel de propiedades y guardado en el server.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api";
import { useStudio } from "../store";
import type { ElementType, LabelElement, LabelTemplate } from "../types";
import { measureText, previewVars, SCALE, substitute } from "../designer/renderSvg";
import { Icon } from "../components/Icon";

type Tool = "select" | ElementType;

const FONTS = [
  "Norwester Condensed",
  "VT323",
  "Share Tech Mono",
  "Audiowide",
  "Rajdhani",
  "Saira Stencil One",
  "Stardos Stencil",
];

const TOOLS: Array<{ tool: Tool; icon: string; title: string }> = [
  { tool: "select", icon: "refresh", title: "Seleccionar / mover" },
  { tool: "text", icon: "type", title: "Texto" },
  { tool: "rectangle", icon: "square", title: "Rectángulo" },
  { tool: "line", icon: "minus", title: "Línea" },
  { tool: "circle", icon: "circle", title: "Círculo" },
  { tool: "stripes", icon: "stripes", title: "Rayas" },
  { tool: "grid", icon: "grid", title: "Rejilla" },
];

function defaultTemplate(): LabelTemplate {
  return {
    name: "nueva-etiqueta",
    description: "Creada en el diseñador",
    dimensions: { width: 227, height: 136 },
    defaultFont: { family: "VT323", size: 24 },
    elements: [
      {
        type: "text",
        content: "{{titulo}}",
        fontSize: 32,
        fontFamily: "VT323",
        position: { x: 113.5, y: 52 },
        align: "center",
      },
      {
        type: "text",
        content: "{{subtitulo}}",
        fontSize: 16,
        fontFamily: "VT323",
        position: { x: 113.5, y: 74 },
        align: "center",
      },
    ],
  };
}

function newElement(type: ElementType, p0: { x: number; y: number }, p1: { x: number; y: number }): LabelElement {
  const b = {
    x: Math.min(p0.x, p1.x),
    y: Math.min(p0.y, p1.y),
    width: Math.max(0.5, Math.abs(p1.x - p0.x)),
    height: Math.max(0.5, Math.abs(p1.y - p0.y)),
  };
  switch (type) {
    case "text":
      return { type: "text", content: "Texto", fontSize: 20, fontFamily: "VT323", position: { ...p0 }, align: "left" };
    case "rectangle":
      return { type: "rectangle", position: { x: b.x, y: b.y }, width: b.width, height: b.height, filled: false, lineWidth: 1 };
    case "line":
      return { type: "line", start: { ...p0 }, end: { ...p1 }, width: 1 };
    case "circle": {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      return { type: "circle", center: { ...p0 }, radius: Math.max(0.5, Math.hypot(dx, dy)), lineWidth: 1, filled: false };
    }
    case "stripes":
      return { type: "stripes", bounds: b, spacing: 6, width: 1.5, direction: "vertical" };
    case "grid":
      return { type: "grid", bounds: b, cellWidth: 8, cellHeight: 8, lineWidth: 0.5, alpha: 0.4 };
    default:
      return { type: "text", content: "Texto", fontSize: 20, position: { ...p0 } };
  }
}

function hitTest(el: LabelElement, ux: number, uy: number): boolean {
  const P = (p?: { x: number; y: number }) => p ?? { x: 0, y: 0 };
  switch (el.type) {
    case "text": {
      const family = el.fontFamily ?? "VT323";
      const size = el.fontSize ?? 16;
      const w = measureText(el.content ?? "", family, size * SCALE, el.weight ?? "normal") / SCALE;
      const h = size * 1.3;
      const x0 = el.align === "center" ? P(el.position).x - w / 2 : el.align === "right" ? P(el.position).x - w : P(el.position).x;
      const y0 = P(el.position).y - size * 0.95;
      return ux >= x0 && ux <= x0 + w && uy >= y0 && uy <= y0 + h;
    }
    case "rectangle": {
      const p = P(el.position);
      return ux >= p.x && ux <= p.x + (el.width ?? 0) && uy >= p.y && uy <= p.y + (el.height ?? 0);
    }
    case "line": {
      const a = P(el.start);
      const b = P(el.end);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((ux - a.x) * dx + (uy - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      return Math.hypot(ux - px, uy - py) <= Math.max(2, ((el.width ?? 1) + 2) / 2);
    }
    case "circle": {
      const c = P(el.center);
      const d = Math.hypot(ux - c.x, uy - c.y);
      const r = el.radius ?? 0;
      return el.filled ? d <= r : Math.abs(d - r) <= Math.max(2, ((el.lineWidth ?? 1) + 2) / 2);
    }
    case "stripes":
    case "grid": {
      if (!el.bounds) return true;
      const b = el.bounds;
      return ux >= b.x && ux <= b.x + b.width && uy >= b.y && uy <= b.y + b.height;
    }
    default:
      return false;
  }
}

type DragState =
  | { mode: "move"; id: number; start: { x: number; y: number } }
  | { mode: "draw"; tool: ElementType; start: { x: number; y: number }; current: { x: number; y: number } };

export function Designer() {
  const { health, bumpRefresh } = useStudio();
  const [tpl, setTpl] = useState<LabelTemplate>(defaultTemplate);
  const [name, setName] = useState("nueva-etiqueta");
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<LabelElement | null>(null);

  const dimW = tpl.dimensions?.width ?? 227;
  const dimH = tpl.dimensions?.height ?? 136;

  // Cargar plantilla pedida desde la sidebar (o por URL de sesión)
  useEffect(() => {
    const pending = sessionStorage.getItem("studio.designerTemplate");
    if (pending) {
      sessionStorage.removeItem("studio.designerTemplate");
      api
        .getTemplate(pending)
        .then((t) => {
          setTpl(t);
          setName(pending);
          setSelected(null);
        })
        .catch((e) => setMsg({ kind: "err", text: `No se pudo cargar "${pending}": ${e.message}` }));
    }
  }, []);

  const vars = useMemo(() => previewVars(tpl), [tpl]);
  const variables = useMemo(() => Object.keys(vars).sort(), [vars]);

  const updateElement = (id: number, fn: (el: LabelElement) => LabelElement) => {
    setTpl((prev) => ({ ...prev, elements: prev.elements.map((el, i) => (i === id ? fn(el) : el)) }));
  };

  const moveElement = (el: LabelElement, dx: number, dy: number) => {
    const P = (p?: { x: number; y: number }) => {
      if (!p) return p;
      return { x: Math.round((p.x + dx) * 10) / 10, y: Math.round((p.y + dy) * 10) / 10 };
    };
    if (el.type === "line") {
      el.start = P(el.start);
      el.end = P(el.end);
    } else if (el.type === "circle") {
      el.center = P(el.center);
    } else if (el.type === "stripes" || el.type === "grid") {
      if (el.bounds) el.bounds = { ...el.bounds, x: el.bounds.x + dx, y: el.bounds.y + dy };
    } else {
      el.position = P(el.position);
    }
  };

  const toUnits = (e: ReactPointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * (dimW / rect.width)) / SCALE,
      y: ((e.clientY - rect.top) * (dimH / rect.height)) / SCALE,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = toUnits(e);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool === "select") {
      for (let i = tpl.elements.length - 1; i >= 0; i--) {
        if (hitTest(tpl.elements[i], p.x, p.y)) {
          setSelected(i);
          drag.current = { mode: "move", id: i, start: p };
          return;
        }
      }
      setSelected(null);
    } else {
      drag.current = { mode: "draw", tool, start: p, current: p };
      setGhost(newElement(tool, p, p));
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toUnits(e);
    if (d.mode === "move") {
      const el = tpl.elements[d.id];
      if (!el) return;
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      setTpl((prev) => {
        const target = prev.elements[d.id];
        if (!target) return prev;
        const copy = JSON.parse(JSON.stringify(target)) as LabelElement;
        moveElement(copy, dx, dy);
        return { ...prev, elements: prev.elements.map((x, i) => (i === d.id ? copy : x)) };
      });
    } else {
      drag.current = { ...d, current: p };
      setGhost(newElement(d.tool, d.start, p));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "draw") {
      const el = newElement(d.tool, d.start, d.current);
      if (d.tool === "text" && Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) < 4) {
        setTpl((prev) => ({ ...prev, elements: [...prev.elements, el] }));
        setSelected(tpl.elements.length);
      } else if (d.tool !== "text") {
        setTpl((prev) => ({ ...prev, elements: [...prev.elements, el] }));
        setSelected(tpl.elements.length);
      }
    }
    setGhost(null);
  };

  const removeSelected = () => {
    if (selected === null) return;
    setTpl((prev) => ({ ...prev, elements: prev.elements.filter((_, i) => i !== selected) }));
    setSelected(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safe) throw new Error("Nombre inválido (solo letras, números, _ y -)");
      await api.saveTemplate(safe, { ...tpl, name: safe });
      setName(safe);
      setMsg({ kind: "ok", text: `Plantilla "${safe}" guardada en el servidor` });
      bumpRefresh();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const print = async (dryRun: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      // Se envía la plantilla inline (objeto) para poder probar sin guardar
      const res = await api.print(tpl, previewVars(tpl), dryRun);
      setMsg({
        kind: "ok",
        text: dryRun
          ? `Dry-run OK: ${res.bytes} bytes (${res.mediaType}) → ${res.device}`
          : `Enviado a imprimir: ${res.bytes} bytes (${res.mediaType}) → ${res.device}`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const selectedEl = selected !== null ? tpl.elements[selected] : null;

  return (
    <div className="designer">
      {/* Barra de herramientas */}
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool-btn${tool === t.tool ? " active" : ""}${t.tool === "text" ? " tool-sep" : ""}`}
            title={t.title}
            onClick={() => setTool(t.tool)}
          >
            <Icon name={t.icon} size={19} />
          </button>
        ))}
      </div>

      {/* Lienzo */}
      <div className="canvas-wrap">
        <svg
          ref={svgRef}
          className="label-canvas"
          viewBox={`0 0 ${dimW} ${dimH}`}
          width={dimW * zoom}
          height={dimH * zoom}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <rect x={0} y={0} width={dimW} height={dimH} fill={tpl.background === "black" ? "#000" : "#fff"} />
          {tpl.elements.map((el, i) => (
            <g
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(i);
              }}
            >
              <ElementSvg el={el} vars={vars} selected={selected === i} />
            </g>
          ))}
          {ghost && (
            <g opacity={0.55} strokeDasharray="4 3" stroke="#1db954" fill="none">
              <ElementSvg el={ghost} vars={{}} selected={false} />
            </g>
          )}
        </svg>
        <div className="canvas-zoom">
          <button onClick={() => setZoom((z) => Math.max(1, z - 1))}>−</button>
          <span className="mono" style={{ fontSize: 12, alignSelf: "center", padding: "0 4px" }}>
            {zoom}×
          </span>
          <button onClick={() => setZoom((z) => Math.min(6, z + 1))}>+</button>
        </div>
      </div>

      {/* Panel de propiedades */}
      <div className="props-panel">
        <h3>Plantilla</h3>
        <div className="prop-row">
          <label>Nombre</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="prop-row">
          <label>Ancho px</label>
          <input
            type="number"
            value={dimW}
            onChange={(e) => setTpl((p) => ({ ...p, dimensions: { width: Number(e.target.value) || 0, height: dimH } }))}
          />
        </div>
        <div className="prop-row">
          <label>Alto px</label>
          <input
            type="number"
            value={dimH}
            onChange={(e) => setTpl((p) => ({ ...p, dimensions: { width: dimW, height: Number(e.target.value) || 0 } }))}
          />
        </div>
        <div className="prop-row">
          <label>Fondo</label>
          <select value={tpl.background ?? "white"} onChange={(e) => setTpl((p) => ({ ...p, background: e.target.value as "white" | "black" }))}>
            <option value="white">Blanco</option>
            <option value="black">Negro</option>
          </select>
        </div>

        <h3 style={{ marginTop: 18 }}>Variables</h3>
        {variables.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Usa {"{{nombre}}"} en un texto para crear variables.
          </div>
        ) : (
          <div className="mono" style={{ fontSize: 12, color: "var(--accent)", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {variables.map((v) => (
              <span key={v} style={{ background: "rgba(29,185,84,0.12)", borderRadius: 4, padding: "2px 6px" }}>
                {"{{" + v + "}}"}
              </span>
            ))}
          </div>
        )}

        <h3 style={{ marginTop: 18 }}>Elemento</h3>
        {selectedEl && selected !== null ? (
          <>
            <PropsEditor el={selectedEl} onChange={(next) => updateElement(selected, () => next)} />
            <button className="btn btn-danger btn-sm mt" onClick={removeSelected}>
              <Icon name="trash" size={14} /> Eliminar
            </button>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            Selecciona un elemento en el lienzo.
          </div>
        )}

        <h3 style={{ marginTop: 18 }}>Acciones</h3>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
            <Icon name="save" size={14} /> Guardar
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !health} onClick={() => void print(true)} title="Genera sin imprimir">
            Dry-run
          </button>
          <button className="btn btn-dark btn-sm" disabled={busy || !health} onClick={() => void print(false)}>
            <Icon name="printer" size={14} /> Imprimir
          </button>
        </div>
        {msg && <div className={`${msg.kind === "ok" ? "ok-text" : "err-text"} mt`}>{msg.text}</div>}
      </div>
    </div>
  );
}

// Renderiza un elemento con su configuración real (o ghost).
function ElementSvg({ el, vars, selected }: { el: LabelElement; vars: Record<string, string>; selected: boolean }) {
  const S = (n?: number) => Math.round((n ?? 0) * SCALE);
  const sel = selected
    ? { stroke: "#1db954", strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const }
    : {};
  switch (el.type) {
    case "text":
      return (
        <text
          x={S(el.position?.x)}
          y={S(el.position?.y)}
          fontSize={S(el.fontSize ?? 16)}
          fontFamily={`"${el.fontFamily ?? "VT323"}"`}
          fontWeight={el.weight ?? "normal"}
          textAnchor={el.align === "center" ? "middle" : el.align === "right" ? "end" : "start"}
          fill="currentColor"
          {...sel}
        >
          {substitute(el.content ?? "", vars)}
        </text>
      );
    case "rectangle":
      return (
        <rect
          x={S(el.position?.x)}
          y={S(el.position?.y)}
          width={Math.max(0, S(el.width ?? 0))}
          height={Math.max(0, S(el.height ?? 0))}
          fill={el.filled ? "currentColor" : "none"}
          stroke={el.filled ? "none" : "currentColor"}
          strokeWidth={el.filled ? 0 : S(el.lineWidth ?? 1)}
          {...sel}
        />
      );
    case "line":
      return (
        <line
          x1={S(el.start?.x)} y1={S(el.start?.y)} x2={S(el.end?.x)} y2={S(el.end?.y)}
          stroke="currentColor" strokeWidth={S(el.width ?? 1)}
          {...sel}
        />
      );
    case "circle":
      return (
        <circle
          cx={S(el.center?.x)} cy={S(el.center?.y)} r={Math.max(0, S(el.radius ?? 0))}
          fill={el.filled ? "currentColor" : "none"}
          stroke={el.filled ? "none" : "currentColor"}
          strokeWidth={el.filled ? 0 : S(el.lineWidth ?? 1)}
          {...sel}
        />
      );
    case "stripes":
    case "grid":
      // Los tipos complejos se renderizan a través del renderer principal;
      // aquí basta con una caja guía para el ghost/borrador.
      return (
        <rect
          x={S(el.bounds?.x)} y={S(el.bounds?.y)}
          width={Math.max(0, S(el.bounds?.width ?? 0))}
          height={Math.max(0, S(el.bounds?.height ?? 0))}
          fill="none" stroke="currentColor" strokeWidth={1}
          {...sel}
        />
      );
    default:
      return null;
  }
}

interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "checkbox";
  options?: string[];
  get: (el: LabelElement) => string | number | boolean;
  set: (el: LabelElement, v: string | number | boolean) => void;
}

function PropsEditor({ el, onChange }: { el: LabelElement; onChange: (el: LabelElement) => void }) {
  const fields: FieldDef[] = [];
  const num = (key: string, label: string, get: (e: LabelElement) => number | undefined, set: (e: LabelElement, n: number) => void) =>
    fields.push({ key, label, type: "number", get: (e) => get(e) ?? 0, set: (e, v) => set(e, Number(v)) });

  if (el.type === "text") {
    fields.push({ key: "content", label: "Contenido", type: "text", get: (e) => e.content ?? "", set: (e, v) => (e.content = String(v)) });
    num("fontSize", "Tamaño", (e) => e.fontSize, (e, n) => (e.fontSize = n));
    fields.push({
      key: "fontFamily", label: "Fuente", type: "select", options: FONTS,
      get: (e) => e.fontFamily ?? "VT323",
      set: (e, v) => (e.fontFamily = String(v)),
    });
    fields.push({
      key: "align", label: "Alineación", type: "select", options: ["left", "center", "right"],
      get: (e) => e.align ?? "left",
      set: (e, v) => (e.align = v as "left" | "center" | "right"),
    });
    num("x", "X", (e) => e.position?.x, (e, n) => (e.position = { ...(e.position ?? { y: 0 }), x: n }));
    num("y", "Y", (e) => e.position?.y, (e, n) => (e.position = { ...(e.position ?? { x: 0 }), y: n }));
  } else if (el.type === "rectangle") {
    num("x", "X", (e) => e.position?.x, (e, n) => (e.position = { ...(e.position ?? { y: 0 }), x: n }));
    num("y", "Y", (e) => e.position?.y, (e, n) => (e.position = { ...(e.position ?? { x: 0 }), y: n }));
    num("width", "Ancho", (e) => e.width, (e, n) => (e.width = n));
    num("height", "Alto", (e) => e.height, (e, n) => (e.height = n));
    num("lineWidth", "Grosor", (e) => e.lineWidth, (e, n) => (e.lineWidth = n));
    fields.push({ key: "filled", label: "Relleno", type: "checkbox", get: (e) => !!e.filled, set: (e, v) => (e.filled = Boolean(v)) });
  } else if (el.type === "line") {
    num("x1", "X1", (e) => e.start?.x, (e, n) => (e.start = { ...(e.start ?? { y: 0 }), x: n }));
    num("y1", "Y1", (e) => e.start?.y, (e, n) => (e.start = { ...(e.start ?? { x: 0 }), y: n }));
    num("x2", "X2", (e) => e.end?.x, (e, n) => (e.end = { ...(e.end ?? { y: 0 }), x: n }));
    num("y2", "Y2", (e) => e.end?.y, (e, n) => (e.end = { ...(e.end ?? { x: 0 }), y: n }));
    num("width", "Grosor", (e) => e.width, (e, n) => (e.width = n));
  } else if (el.type === "circle") {
    num("cx", "CX", (e) => e.center?.x, (e, n) => (e.center = { ...(e.center ?? { y: 0 }), x: n }));
    num("cy", "CY", (e) => e.center?.y, (e, n) => (e.center = { ...(e.center ?? { x: 0 }), y: n }));
    num("radius", "Radio", (e) => e.radius, (e, n) => (e.radius = n));
    num("lineWidth", "Grosor", (e) => e.lineWidth, (e, n) => (e.lineWidth = n));
    fields.push({ key: "filled", label: "Relleno", type: "checkbox", get: (e) => !!e.filled, set: (e, v) => (e.filled = Boolean(v)) });
  } else if (el.type === "stripes") {
    const b = (e: LabelElement) => e.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    num("bx", "BX", (e) => b(e).x, (e, n) => (e.bounds = { ...b(e), x: n }));
    num("by", "BY", (e) => b(e).y, (e, n) => (e.bounds = { ...b(e), y: n }));
    num("bw", "Ancho", (e) => b(e).width, (e, n) => (e.bounds = { ...b(e), width: n }));
    num("bh", "Alto", (e) => b(e).height, (e, n) => (e.bounds = { ...b(e), height: n }));
    num("spacing", "Espacio", (e) => e.spacing, (e, n) => (e.spacing = n));
    num("width", "Grosor", (e) => e.width, (e, n) => (e.width = n));
    fields.push({
      key: "direction", label: "Dirección", type: "select", options: ["vertical", "horizontal"],
      get: (e) => e.direction ?? "vertical",
      set: (e, v) => (e.direction = v as "vertical" | "horizontal"),
    });
  } else if (el.type === "grid") {
    const b = (e: LabelElement) => e.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    num("bx", "BX", (e) => b(e).x, (e, n) => (e.bounds = { ...b(e), x: n }));
    num("by", "BY", (e) => b(e).y, (e, n) => (e.bounds = { ...b(e), y: n }));
    num("bw", "Ancho", (e) => b(e).width, (e, n) => (e.bounds = { ...b(e), width: n }));
    num("bh", "Alto", (e) => b(e).height, (e, n) => (e.bounds = { ...b(e), height: n }));
    num("cellWidth", "Celda W", (e) => e.cellWidth, (e, n) => (e.cellWidth = n));
    num("cellHeight", "Celda H", (e) => e.cellHeight, (e, n) => (e.cellHeight = n));
    num("lineWidth", "Grosor", (e) => e.lineWidth, (e, n) => (e.lineWidth = n));
    num("alpha", "Opacidad", (e) => e.alpha, (e, n) => (e.alpha = n));
  }

  const set = (f: FieldDef, v: string | number | boolean) => {
    const copy = JSON.parse(JSON.stringify(el)) as LabelElement;
    f.set(copy, v);
    onChange(copy);
  };

  return (
    <>
      {fields.map((f) => (
        <div className="prop-row" key={f.key}>
          <label>{f.label}</label>
          {f.type === "checkbox" ? (
            <input type="checkbox" checked={Boolean(f.get(el))} onChange={(e) => set(f, e.target.checked)} />
          ) : f.type === "select" ? (
            <select value={String(f.get(el))} onChange={(e) => set(f, e.target.value)}>
              {f.options!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={String(f.get(el))}
              onChange={(e) => set(f, f.type === "number" ? Number(e.target.value) : e.target.value)}
            />
          )}
        </div>
      ))}
    </>
  );
}
