// Diseñador de etiquetas — experiencia tipo Illustrator:
// herramientas, lienzo con reglas, paneles de capas/propiedades,
// handles de redimensionar, deshacer/rehacer, atajos, zoom y guías.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api";
import { useStudio } from "../store";
import type { ElementType, LabelElement, LabelTemplate } from "../types";
import { measureText, previewVars, SCALE, substitute } from "../designer/renderSvg";
import { Icon } from "../components/Icon";

type Tool = "select" | ElementType;
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type PanelTab = "layers" | "props";

const FONTS = [
  "Norwester Condensed",
  "VT323",
  "Share Tech Mono",
  "Audiowide",
  "Rajdhani",
  "Saira Stencil One",
  "Stardos Stencil",
];

const TOOLS: Array<{ tool: Tool; icon: string; title: string; key: string }> = [
  { tool: "select", icon: "cursor", title: "Selección", key: "V" },
  { tool: "text", icon: "type", title: "Texto", key: "T" },
  { tool: "rectangle", icon: "square", title: "Rectángulo", key: "R" },
  { tool: "line", icon: "minus", title: "Línea", key: "L" },
  { tool: "circle", icon: "circle", title: "Círculo", key: "O" },
  { tool: "stripes", icon: "stripes", title: "Rayas", key: "B" },
  { tool: "grid", icon: "grid", title: "Rejilla", key: "G" },
];

const TYPE_ICON: Record<ElementType, string> = {
  text: "type",
  rectangle: "square",
  line: "minus",
  circle: "circle",
  stripes: "stripes",
  grid: "grid",
};

const TYPE_NAME: Record<ElementType, string> = {
  text: "Texto",
  rectangle: "Rectángulo",
  line: "Línea",
  circle: "Círculo",
  stripes: "Rayas",
  grid: "Rejilla",
};

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Doc {
  past: LabelTemplate[];
  present: LabelTemplate;
  future: LabelTemplate[];
}

type Drag =
  | { mode: "move"; id: number; start: { x: number; y: number } }
  | { mode: "resize"; id: number; handle: Handle; origBBox: BBox }
  | { mode: "draw"; tool: ElementType; start: { x: number; y: number }; current: { x: number; y: number } };

function defaultTemplate(): LabelTemplate {
  return {
    name: "nueva-etiqueta",
    description: "Creada en el diseñador",
    dimensions: { width: 227, height: 136 },
    defaultFont: { family: "VT323", size: 24 },
    elements: [
      { type: "text", content: "{{titulo}}", fontSize: 32, fontFamily: "VT323", position: { x: 113.5, y: 52 }, align: "center", label: "Título" },
      { type: "text", content: "{{subtitulo}}", fontSize: 16, fontFamily: "VT323", position: { x: 113.5, y: 74 }, align: "center", label: "Subtítulo" },
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
      return { type: "text", content: "Texto", fontSize: 20, fontFamily: "VT323", position: { ...p0 }, align: "left", label: "Texto" };
    case "rectangle":
      return { type: "rectangle", position: { x: b.x, y: b.y }, width: b.width, height: b.height, filled: false, lineWidth: 1, label: "Rectángulo" };
    case "line":
      return { type: "line", start: { ...p0 }, end: { ...p1 }, width: 1, label: "Línea" };
    case "circle": {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      return { type: "circle", center: { ...p0 }, radius: Math.max(0.5, Math.hypot(dx, dy)), lineWidth: 1, filled: false, label: "Círculo" };
    }
    case "stripes":
      return { type: "stripes", bounds: b, spacing: 6, width: 1.5, direction: "vertical", label: "Rayas" };
    case "grid":
      return { type: "grid", bounds: b, cellWidth: 8, cellHeight: 8, lineWidth: 0.5, alpha: 0.4, label: "Rejilla" };
    default:
      return { type: "text", content: "Texto", fontSize: 20, position: { ...p0 }, label: "Texto" };
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

function elementBBox(el: LabelElement, dimW: number, dimH: number): BBox {
  const P = (p?: { x: number; y: number }) => p ?? { x: 0, y: 0 };
  switch (el.type) {
    case "text": {
      const family = el.fontFamily ?? "VT323";
      const size = el.fontSize ?? 16;
      const w = measureText(el.content ?? "", family, size * SCALE, el.weight ?? "normal") / SCALE;
      const h = size * 1.3;
      const p = P(el.position);
      const x0 = el.align === "center" ? p.x - w / 2 : el.align === "right" ? p.x - w : p.x;
      return { x: x0, y: p.y - size * 0.95, w, h };
    }
    case "rectangle": {
      const p = P(el.position);
      return { x: p.x, y: p.y, w: el.width ?? 0, h: el.height ?? 0 };
    }
    case "line": {
      const a = P(el.start);
      const b = P(el.end);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(1, Math.abs(b.x - a.x)), h: Math.max(1, Math.abs(b.y - a.y)) };
    }
    case "circle": {
      const c = P(el.center);
      const r = el.radius ?? 0;
      return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 };
    }
    case "stripes":
    case "grid": {
      const b = el.bounds ?? { x: 0, y: 0, width: dimW, height: dimH };
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    default:
      return { x: 0, y: 0, w: 10, h: 10 };
  }
}

/** Aplica un bbox nuevo a un elemento (redimensionado). */
function applyBBox(el: LabelElement, bb: BBox, origBBox: BBox): LabelElement {
  const out = JSON.parse(JSON.stringify(el)) as LabelElement;
  const w = Math.max(2, bb.w);
  const h = Math.max(2, bb.h);
  switch (el.type) {
    case "rectangle":
      out.position = { x: bb.x, y: bb.y };
      out.width = w;
      out.height = h;
      break;
    case "circle":
      out.center = { x: bb.x + w / 2, y: bb.y + h / 2 };
      out.radius = Math.max(0.5, Math.max(w, h) / 2);
      break;
    case "text": {
      const scale = origBBox.w > 0 ? w / origBBox.w : 1;
      const size = Math.max(4, Math.round((el.fontSize ?? 16) * scale * 10) / 10);
      out.fontSize = size;
      const p = el.position ?? { x: 0, y: 0 };
      if (el.align === "center") out.position = { x: bb.x + w / 2, y: p.y + (bb.y - origBBox.y) };
      else if (el.align === "right") out.position = { x: bb.x + w, y: p.y + (bb.y - origBBox.y) };
      else out.position = { x: bb.x, y: p.y + (bb.y - origBBox.y) };
      break;
    }
    case "line": {
      const map = (v: number, a: number) => (origBBox.w > 0 ? bb.x + ((v - a) / origBBox.w) * w : bb.x);
      const mapY = (v: number, a: number) => (origBBox.h > 0 ? bb.y + ((v - a) / origBBox.h) * h : bb.y);
      out.start = { x: map(el.start?.x ?? 0, origBBox.x), y: mapY(el.start?.y ?? 0, origBBox.y) };
      out.end = { x: map(el.end?.x ?? 0, origBBox.x), y: mapY(el.end?.y ?? 0, origBBox.y) };
      break;
    }
    case "stripes":
    case "grid":
      out.bounds = { x: bb.x, y: bb.y, width: w, height: h };
      break;
  }
  return out;
}

/** Nuevo bbox según handle arrastrado hasta el punto p (unidades de diseño). */
function bboxFromDrag(orig: BBox, handle: Handle, p: { x: number; y: number }): BBox {
  let x1 = orig.x;
  let y1 = orig.y;
  let x2 = orig.x + orig.w;
  let y2 = orig.y + orig.h;
  if (handle.includes("w")) x1 = Math.min(p.x, x2);
  if (handle.includes("e")) x2 = Math.max(p.x, orig.x);
  if (handle.includes("n")) y1 = Math.min(p.y, y2);
  if (handle.includes("s")) y2 = Math.max(p.y, orig.y);
  if (handle === "w" || handle === "e") {
    y1 = orig.y;
    y2 = orig.y + orig.h;
  }
  if (handle === "n" || handle === "s") {
    x1 = orig.x;
    x2 = orig.x + orig.w;
  }
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function elementLabel(el: LabelElement): string {
  if (el.label) return el.label;
  if (el.type === "text") return el.content?.slice(0, 18) || "Texto";
  return TYPE_NAME[el.type];
}

export function Designer() {
  const { health, bumpRefresh } = useStudio();
  const [doc, setDoc] = useState<Doc>({ past: [], present: defaultTemplate(), future: [] });
  const tpl = doc.present;
  const [name, setName] = useState("nueva-etiqueta");
  const [dirty, setDirty] = useState(false);
  const savedRef = useRef<string>(JSON.stringify(tpl));
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(3);
  const [tab, setTab] = useState<PanelTab>("layers");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [ghost, setGhost] = useState<LabelElement | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [offsets, setOffsets] = useState({ x: 0, y: 0 });

  const dimW = tpl.dimensions?.width ?? 227;
  const dimH = tpl.dimensions?.height ?? 136;
  const vars = useMemo(() => previewVars(tpl), [tpl]);
  const variables = useMemo(() => Object.keys(vars).sort(), [vars]);

  // ---- Historial ----------------------------------------------------------
  const commit = useCallback((next: LabelTemplate) => {
    setDoc((d) => ({ past: [...d.past, d.present].slice(-60), present: next, future: [] }));
    setDirty(JSON.stringify(next) !== savedRef.current);
  }, []);
  const commitEl = useCallback(
    (i: number, fn: (el: LabelElement) => LabelElement) => {
      setDoc((d) => {
        const next = {
          ...d.present,
          elements: d.present.elements.map((e, idx) => (idx === i ? fn(JSON.parse(JSON.stringify(e)) as LabelElement) : e)),
        };
        setDirty(JSON.stringify(next) !== savedRef.current);
        return { past: [...d.past, d.present].slice(-60), present: next, future: [] };
      });
    },
    []
  );
  const setPresent = useCallback((next: LabelTemplate) => {
    setDoc((d) => ({ ...d, present: next }));
    setDirty(JSON.stringify(next) !== savedRef.current);
  }, []);
  const beginDrag = useCallback(() => {
    setDoc((d) => ({ past: [...d.past, d.present].slice(-60), present: d.present, future: [] }));
  }, []);
  const undo = useCallback(
    () =>
      setDoc((d) => {
        if (d.past.length === 0) return d;
        const present = d.past[d.past.length - 1];
        setDirty(JSON.stringify(present) !== savedRef.current);
        return { past: d.past.slice(0, -1), present, future: [d.present, ...d.future] };
      }),
    []
  );
  const redo = useCallback(
    () =>
      setDoc((d) => {
        if (d.future.length === 0) return d;
        const present = d.future[0];
        setDirty(JSON.stringify(present) !== savedRef.current);
        return { past: [...d.past, d.present], present, future: d.future.slice(1) };
      }),
    []
  );

  // ---- Cargar plantilla pendiente (sidebar) --------------------------------
  useEffect(() => {
    const pending = sessionStorage.getItem("studio.designerTemplate");
    if (pending) {
      sessionStorage.removeItem("studio.designerTemplate");
      api
        .getTemplate(pending)
        .then((t) => {
          setDoc({ past: [], present: t, future: [] });
          setName(pending);
          savedRef.current = JSON.stringify(t);
          setDirty(false);
          setSelected(null);
        })
        .catch((e) => setMsg({ kind: "err", text: `No se pudo cargar "${pending}": ${e.message}` }));
    }
  }, []);

  // ---- Atajos de teclado ---------------------------------------------------
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (ctrl && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && k === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (ctrl && k === "d") {
        e.preventDefault();
        duplicate();
        return;
      }
      if (ctrl && k === "0") {
        e.preventDefault();
        fitZoom();
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected !== null) removeElement(selected);
        return;
      }
      if (k === "v") setTool("select");
      else if (k === "t") setTool("text");
      else if (k === "r") setTool("rectangle");
      else if (k === "l") setTool("line");
      else if (k === "o") setTool("circle");
      else if (k === "b") setTool("stripes");
      else if (k === "g") setTool("grid");
      if (e.key.startsWith("Arrow") && selected !== null) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        const step = e.shiftKey ? 10 : 1;
        moveBy(selected, dx * step, dy * step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, doc.present, undo, redo]);

  // ---- Zoom con Ctrl+rueda (no-passive) ------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((z) => Math.min(8, Math.max(0.5, Math.round(z * factor * 10) / 10)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Medir offsets del lienzo para las reglas ----------------------------
  const measureOffsets = useCallback(() => {
    const sc = scrollRef.current;
    const sv = svgRef.current;
    if (!sc || !sv) return;
    const sr = sv.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    setOffsets({ x: sr.left - cr.left, y: sr.top - cr.top });
  }, []);

  useEffect(() => {
    measureOffsets();
    const ro = new ResizeObserver(() => measureOffsets());
    if (scrollRef.current) ro.observe(scrollRef.current);
    window.addEventListener("resize", measureOffsets);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureOffsets);
    };
  }, [measureOffsets, zoom, dimW, dimH]);

  // ---- Operaciones de documento --------------------------------------------
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safe) throw new Error("Nombre inválido (solo letras, números, _ y -)");
      const clean = { ...tpl, name: safe, elements: tpl.elements.map(({ locked, hidden, label, ...el }) => el) };
      await api.saveTemplate(safe, clean);
      setName(safe);
      savedRef.current = JSON.stringify(tpl);
      setDirty(false);
      setMsg({ kind: "ok", text: `Plantilla "${safe}" guardada` });
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
      const res = await api.print(tpl, previewVars(tpl), dryRun);
      setMsg({
        kind: "ok",
        text: dryRun ? `Dry-run OK: ${res.bytes} bytes (${res.mediaType}) → ${res.device}` : `Enviado: ${res.bytes} bytes (${res.mediaType}) → ${res.device}`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const duplicate = () => {
    if (selected === null) return;
    setDoc((d) => {
      const el = d.present.elements[selected];
      if (!el) return d;
      const copy = JSON.parse(JSON.stringify(el)) as LabelElement;
      const off = el.type === "line" ? 4 : 4;
      if (copy.position) copy.position = { x: copy.position.x + off, y: copy.position.y + off };
      if (copy.start) {
        copy.start = { x: copy.start.x + off, y: copy.start.y + off };
        copy.end = { x: (copy.end?.x ?? 0) + off, y: (copy.end?.y ?? 0) + off };
      }
      if (copy.center) copy.center = { x: copy.center.x + off, y: copy.center.y + off };
      if (copy.bounds) copy.bounds = { ...copy.bounds, x: copy.bounds.x + off, y: copy.bounds.y + off };
      copy.label = elementLabel(el);
      const elements = [...d.present.elements];
      elements.splice(selected + 1, 0, copy);
      const next = { ...d.present, elements };
      setDirty(JSON.stringify(next) !== savedRef.current);
      setSelected(selected + 1);
      return { past: [...d.past, d.present].slice(-60), present: next, future: [] };
    });
  };

  const removeElement = (i: number) => {
    setDoc((d) => {
      const next = { ...d.present, elements: d.present.elements.filter((_, idx) => idx !== i) };
      setDirty(JSON.stringify(next) !== savedRef.current);
      return { past: [...d.past, d.present].slice(-60), present: next, future: [] };
    });
    setSelected(null);
  };

  const moveBy = (i: number, dx: number, dy: number) => {
    beginDrag();
    setPresent({
      ...tpl,
      elements: tpl.elements.map((el, idx) => {
        if (idx !== i) return el;
        const copy = JSON.parse(JSON.stringify(el)) as LabelElement;
        const P = (p?: { x: number; y: number }) => (p ? { x: Math.round((p.x + dx) * 10) / 10, y: Math.round((p.y + dy) * 10) / 10 } : p);
        if (copy.type === "line") {
          copy.start = P(copy.start);
          copy.end = P(copy.end);
        } else if (copy.type === "circle") {
          copy.center = P(copy.center);
        } else if (copy.type === "stripes" || copy.type === "grid") {
          if (copy.bounds) copy.bounds = { ...copy.bounds, x: copy.bounds.x + dx, y: copy.bounds.y + dy };
        } else {
          copy.position = P(copy.position);
        }
        return copy;
      }),
    });
  };

  const reorder = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tpl.elements.length) return;
    setDoc((d) => {
      const elements = [...d.present.elements];
      [elements[i], elements[j]] = [elements[j], elements[i]];
      const next = { ...d.present, elements };
      setDirty(JSON.stringify(next) !== savedRef.current);
      return { past: [...d.past, d.present].slice(-60), present: next, future: [] };
    });
    setSelected(j);
  };

  const toggleMeta = (i: number, key: "hidden" | "locked") => {
    commitEl(i, (el) => ({ ...el, [key]: !el[key] }));
  };

  const fitZoom = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const z = Math.min(6, Math.max(0.5, Math.floor(Math.min((sc.clientWidth - 120) / dimW, (sc.clientHeight - 120) / dimH) * 10) / 10));
    setZoom(z);
  };

  // ---- Interacción con el lienzo ------------------------------------------
  const toUnits = (e: ReactPointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * (dimW / rect.width)) / SCALE,
      y: ((e.clientY - rect.top) * (dimH / rect.height)) / SCALE,
    };
  };

  const handleHit = (e: ReactPointerEvent, bb: BBox): Handle | null => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * (dimW / rect.width)) / SCALE;
    const sy = ((e.clientY - rect.top) * (dimH / rect.height)) / SCALE;
    const R = 7 / zoom;
    const pts: Array<[Handle, number, number]> = [
      ["nw", bb.x, bb.y],
      ["n", bb.x + bb.w / 2, bb.y],
      ["ne", bb.x + bb.w, bb.y],
      ["e", bb.x + bb.w, bb.y + bb.h / 2],
      ["se", bb.x + bb.w, bb.y + bb.h],
      ["s", bb.x + bb.w / 2, bb.y + bb.h],
      ["sw", bb.x, bb.y + bb.h],
      ["w", bb.x, bb.y + bb.h / 2],
    ];
    for (const [h, px, py] of pts) {
      if (Math.hypot(sx - px, sy - py) <= R) return h;
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = toUnits(e);
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer sintético/test sin captura real */
    }

    if (tool === "select") {
      // 1) handles del elemento seleccionado
      if (selected !== null && !tpl.elements[selected]?.locked) {
        const bb = elementBBox(tpl.elements[selected], dimW, dimH);
        const h = handleHit(e, bb);
        if (h) {
          beginDrag();
          drag.current = { mode: "resize", id: selected, handle: h, origBBox: bb };
          return;
        }
      }
      // 2) hit test de elementos
      for (let i = tpl.elements.length - 1; i >= 0; i--) {
        const el = tpl.elements[i];
        if (el.hidden || el.locked) continue;
        if (hitTest(el, p.x, p.y)) {
          setSelected(i);
          beginDrag();
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
      // Guías de alineación (centro y bordes del lienzo)
      const bb = elementBBox(el, dimW, dimH);
      const nb = { x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h };
      const gv: number[] = [];
      const gh: number[] = [];
      const cx = nb.x + nb.w / 2;
      const cy = nb.y + nb.h / 2;
      if (Math.abs(cx - dimW / 2) < 2.5) gv.push(dimW / 2);
      if (Math.abs(nb.x) < 2.5) gv.push(0);
      if (Math.abs(nb.x + nb.w - dimW) < 2.5) gv.push(dimW);
      if (Math.abs(cy - dimH / 2) < 2.5) gh.push(dimH / 2);
      if (Math.abs(nb.y) < 2.5) gh.push(0);
      if (Math.abs(nb.y + nb.h - dimH) < 2.5) gh.push(dimH);
      setGuides(gv.length || gh.length ? { v: gv, h: gh } : null);
      setPresent({
        ...tpl,
        elements: tpl.elements.map((x, i) => {
          if (i !== d.id) return x;
          const copy = JSON.parse(JSON.stringify(x)) as LabelElement;
          const P = (p0?: { x: number; y: number }) => (p0 ? { x: Math.round((p0.x + dx) * 10) / 10, y: Math.round((p0.y + dy) * 10) / 10 } : p0);
          if (copy.type === "line") {
            copy.start = P(copy.start);
            copy.end = P(copy.end);
          } else if (copy.type === "circle") {
            copy.center = P(copy.center);
          } else if (copy.type === "stripes" || copy.type === "grid") {
            if (copy.bounds) copy.bounds = { ...copy.bounds, x: copy.bounds.x + dx, y: copy.bounds.y + dy };
          } else {
            copy.position = P(copy.position);
          }
          return copy;
        }),
      });
    } else if (d.mode === "resize") {
      const nb = bboxFromDrag(d.origBBox, d.handle, p);
      setPresent({
        ...tpl,
        elements: tpl.elements.map((el, i) => (i === d.id ? applyBBox(el, nb, d.origBBox) : el)),
      });
    } else {
      drag.current = { ...d, current: p };
      setGhost(newElement(d.tool, d.start, p));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setGuides(null);
    if (!d) return;
    if (d.mode === "draw") {
      const el = newElement(d.tool, d.start, d.current);
      const isTextClick = d.tool === "text" && Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) < 4;
      if (!(d.tool === "text" && !isTextClick)) {
        setDoc((prev) => {
          const next = { ...prev.present, elements: [...prev.present.elements, el] };
          setDirty(JSON.stringify(next) !== savedRef.current);
          return { past: [...prev.past, prev.present].slice(-60), present: next, future: [] };
        });
        setSelected(tpl.elements.length);
        setTool("select");
      }
    }
    setGhost(null);
  };

  const selectedEl = selected !== null ? tpl.elements[selected] : null;
  const selBBox = selectedEl ? elementBBox(selectedEl, dimW, dimH) : null;

  // ---- Reglas --------------------------------------------------------------
  const rulerTicksH = useMemo(() => {
    const out: Array<{ v: number; major: boolean; label?: string }> = [];
    const start = Math.floor(-offsets.x / zoom / 10) * 10;
    const end = Math.ceil((scrollRef.current?.clientWidth ?? 800) / zoom / 10) * 10 + 10;
    for (let v = start; v <= end; v += 5) {
      if (v % 25 === 0) out.push({ v, major: true, label: String(v) });
      else out.push({ v, major: false });
    }
    return out;
  }, [offsets.x, zoom, scroll.x]);

  const rulerTicksV = useMemo(() => {
    const out: Array<{ v: number; major: boolean; label?: string }> = [];
    const start = Math.floor(-offsets.y / zoom / 10) * 10;
    const end = Math.ceil((scrollRef.current?.clientHeight ?? 600) / zoom / 10) * 10 + 10;
    for (let v = start; v <= end; v += 5) {
      if (v % 25 === 0) out.push({ v, major: true, label: String(v) });
      else out.push({ v, major: false });
    }
    return out;
  }, [offsets.y, zoom, scroll.y]);

  const handles: Array<[Handle, number, number]> = selBBox
    ? [
        ["nw", selBBox.x, selBBox.y],
        ["n", selBBox.x + selBBox.w / 2, selBBox.y],
        ["ne", selBBox.x + selBBox.w, selBBox.y],
        ["e", selBBox.x + selBBox.w, selBBox.y + selBBox.h / 2],
        ["se", selBBox.x + selBBox.w, selBBox.y + selBBox.h],
        ["s", selBBox.x + selBBox.w / 2, selBBox.y + selBBox.h],
        ["sw", selBBox.x, selBBox.y + selBBox.h],
        ["w", selBBox.x, selBBox.y + selBBox.h / 2],
      ]
    : [];

  return (
    <div className="designer">
      {/* Herramientas */}
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool-btn${tool === t.tool ? " active" : ""}`}
            title={`${t.title} (${t.key})`}
            onClick={() => setTool(t.tool)}
          >
            <Icon name={t.icon} size={17} />
            <span className="kbd">{t.key}</span>
          </button>
        ))}
      </div>

      {/* Lienzo */}
      <div className="canvas-stage">
        <div className="designer-topbar">
          <div className="doc-title">
            <span className={`dot${dirty ? " dirty" : ""}`} />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ background: "transparent", border: "1px solid transparent", width: 170, fontWeight: 700 }}
              title="Nombre de la plantilla"
            />
          </div>
          <div className="field-sm">
            <label>Ancho</label>
            <input
              type="number"
              value={dimW}
              onChange={(e) =>
                setPresent({ ...tpl, dimensions: { width: Number(e.target.value) || 0, height: dimH } })
              }
              onBlur={() => commit({ ...tpl, dimensions: { width: Number(tpl.dimensions?.width) || 227, height: dimH } })}
            />
          </div>
          <div className="field-sm">
            <label>Alto</label>
            <input
              type="number"
              value={dimH}
              onChange={(e) =>
                setPresent({ ...tpl, dimensions: { width: dimW, height: Number(e.target.value) || 0 } })
              }
              onBlur={() => commit({ ...tpl, dimensions: { width: dimW, height: Number(tpl.dimensions?.height) || 136 } })}
            />
          </div>
          <div className="field-sm">
            <label>Fondo</label>
            <select value={tpl.background ?? "white"} onChange={(e) => commit({ ...tpl, background: e.target.value as "white" | "black" })}>
              <option value="white">Blanco</option>
              <option value="black">Negro</option>
            </select>
          </div>
          <div className="grow" />
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn" style={{ width: 30, height: 30 }} title="Deshacer (Ctrl+Z)" onClick={undo} disabled={doc.past.length === 0}>
              <Icon name="undo" size={14} />
            </button>
            <button className="icon-btn" style={{ width: 30, height: 30 }} title="Rehacer (Ctrl+Shift+Z)" onClick={redo} disabled={doc.future.length === 0}>
              <Icon name="redo" size={14} />
            </button>
          </div>
          {msg && (
            <span className={msg.kind === "ok" ? "ok-text" : "err-text"} style={{ fontSize: 12, maxWidth: 260 }}>
              {msg.text}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" disabled={busy || !health} onClick={() => void print(true)} title="Genera el payload sin imprimir">
            Dry-run
          </button>
          <button className="btn btn-dark btn-sm" disabled={busy || !health} onClick={() => void print(false)}>
            <Icon name="printer" size={13} /> Imprimir
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
            <Icon name="save" size={13} /> Guardar
          </button>
        </div>

        <div style={{ display: "flex", flexShrink: 0 }}>
          <div className="ruler-corner">px</div>
          <div className="ruler h">
            <div className="ruler-body">
              {rulerTicksH.map((t) => (
                <span key={t.v} className={`tick${t.major ? " major" : " minor"}`} style={{ left: offsets.x + t.v * zoom }} />
              ))}
              {rulerTicksH.filter((t) => t.major).map((t) => (
                <span key={`l${t.v}`} className="tick-label" style={{ left: offsets.x + t.v * zoom }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div className="ruler v">
            <div className="ruler-body">
              {rulerTicksV.map((t) => (
                <span key={t.v} className={`tick${t.major ? " major" : " minor"}`} style={{ top: offsets.y + t.v * zoom }} />
              ))}
              {rulerTicksV.filter((t) => t.major).map((t) => (
                <span key={`l${t.v}`} className="tick-label" style={{ top: offsets.y + t.v * zoom }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div
            className="canvas-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setScroll({ x: el.scrollLeft, y: el.scrollTop });
              measureOffsets();
            }}
          >
            <div className="canvas-center">
              <svg
                ref={svgRef}
                className={`label-canvas${tool === "select" ? " selecting" : ""}`}
                viewBox={`0 0 ${dimW} ${dimH}`}
                width={dimW * zoom}
                height={dimH * zoom}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <rect x={0} y={0} width={dimW} height={dimH} fill={tpl.background === "black" ? "#000" : "#fff"} />
                {tpl.elements.map((el, i) =>
                  el.hidden ? null : (
                    <g
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!el.locked) setSelected(i);
                      }}
                    >
                      <ElementSvg el={el} vars={vars} selected={selected === i} />
                    </g>
                  )
                )}

                {/* Guías de alineación */}
                {guides?.v.map((x) => (
                  <line key={`gv${x}`} className="guide-line" x1={x * SCALE} y1={0} x2={x * SCALE} y2={dimH} />
                ))}
                {guides?.h.map((y) => (
                  <line key={`gh${y}`} className="guide-line" x1={0} y1={y * SCALE} x2={dimW} y2={y * SCALE} />
                ))}

                {/* Selección: outline + handles */}
                {selBBox && !selectedEl?.locked && (
                  <>
                    <rect
                      className="selection-outline"
                      x={selBBox.x * SCALE}
                      y={selBBox.y * SCALE}
                      width={selBBox.w * SCALE}
                      height={selBBox.h * SCALE}
                    />
                    {handles.map(([h, x, y]) => (
                      <rect
                        key={h}
                        className="handle-rect"
                        x={x * SCALE - 4}
                        y={y * SCALE - 4}
                        width={8}
                        height={8}
                        rx={1.5}
                      />
                    ))}
                  </>
                )}

                {/* Borrador de dibujo */}
                {ghost && (
                  <g opacity={0.55} strokeDasharray="4 3" stroke="#1db954" fill="none">
                    <ElementSvg el={ghost} vars={{}} selected={false} />
                  </g>
                )}
              </svg>
            </div>

            <div className="zoom-bar">
              <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z / 1.25) * 10) / 10))}>−</button>
              <span className="zoom-val">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(8, Math.round(z * 1.25 * 10) / 10))}>+</button>
              <button onClick={fitZoom} title="Ajustar (Ctrl+0)">
                <Icon name="maximize" size={13} />
              </button>
            </div>
            <div className="dim-hint">
              {dimW}×{dimH} px · {Math.round((dimW / 203) * 25.4)}×{Math.round((dimH / 203) * 25.4)} mm @203dpi
            </div>
          </div>
        </div>

        <div className="shortcuts-hint">
          <span><kbd>V</kbd><kbd>T</kbd><kbd>R</kbd><kbd>L</kbd><kbd>O</kbd><kbd>B</kbd><kbd>G</kbd> herramientas</span>
          <span><kbd>Ctrl</kbd>+<kbd>rueda</kbd> zoom</span>
          <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</span>
          <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> rehacer</span>
          <span><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicar</span>
          <span><kbd>Supr</kbd> eliminar</span>
          <span><kbd>←↑→↓</kbd> mover (×10 con Shift)</span>
          <span><kbd>Ctrl</kbd>+<kbd>S</kbd> guardar</span>
        </div>
      </div>

      {/* Panel derecho */}
      <div className="right-panel">
        <div className="panel-tabs">
          <button className={`panel-tab${tab === "layers" ? " active" : ""}`} onClick={() => setTab("layers")}>
            Capas
          </button>
          <button className={`panel-tab${tab === "props" ? " active" : ""}`} onClick={() => setTab("props")}>
            Propiedades
          </button>
        </div>

        {tab === "layers" ? (
          <div className="panel-body">
            <h3>Capas · {tpl.elements.length}</h3>
            {tpl.elements.length === 0 ? (
              <div className="layers-empty">Sin elementos. Elige una herramienta y dibuja en el lienzo.</div>
            ) : (
              [...tpl.elements.keys()]
                .reverse()
                .map((i) => {
                  const el = tpl.elements[i];
                  return (
                    <div
                      key={i}
                      className={`layer-row${selected === i ? " active" : ""}${el.hidden ? " dim" : ""}`}
                      onClick={() => setSelected(i)}
                    >
                      <span className="layer-icon">
                        <Icon name={TYPE_ICON[el.type]} size={13} />
                      </span>
                      <span className="layer-name">{elementLabel(el)}</span>
                      <button
                        className={`layer-btn${el.hidden ? " off" : ""}`}
                        title={el.hidden ? "Mostrar" : "Ocultar"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMeta(i, "hidden");
                        }}
                      >
                        <Icon name={el.hidden ? "eyeOff" : "eye"} size={13} />
                      </button>
                      <button
                        className={`layer-btn${el.locked ? " off" : ""}`}
                        title={el.locked ? "Desbloquear" : "Bloquear"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMeta(i, "locked");
                        }}
                      >
                        <Icon name={el.locked ? "lock" : "unlock"} size={13} />
                      </button>
                    </div>
                  );
                })
            )}
            <div className="layer-actions">
              <button title="Subir capa" disabled={selected === null || selected >= tpl.elements.length - 1} onClick={() => selected !== null && reorder(selected, 1)}>
                <Icon name="arrowUp" size={13} />
              </button>
              <button title="Bajar capa" disabled={selected === null || selected <= 0} onClick={() => selected !== null && reorder(selected, -1)}>
                <Icon name="arrowDown" size={13} />
              </button>
              <button title="Duplicar (Ctrl+D)" disabled={selected === null} onClick={duplicate}>
                <Icon name="copy" size={13} />
              </button>
              <button title="Eliminar (Supr)" disabled={selected === null} onClick={() => selected !== null && removeElement(selected)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="panel-body">
            <div className="panel-sec">
              <h3>Variables</h3>
              {variables.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  Usa {"{{nombre}}"} en un texto para crear variables.
                </div>
              ) : (
                <div className="mono" style={{ fontSize: 12, color: "var(--accent)", display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {variables.map((v) => (
                    <span key={v} style={{ background: "rgba(29,185,84,0.12)", borderRadius: 4, padding: "2px 6px" }}>
                      {"{{" + v + "}}"}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="prop-divider" />
            <div className="panel-sec">
              <h3>Elemento</h3>
              {!selectedEl || selected === null ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  Selecciona un elemento en el lienzo o en Capas.
                </div>
              ) : (
                <>
                  <PropsEditor el={selectedEl} onChange={(next) => commitEl(selected, () => next)} />
                  <div className="row mt" style={{ gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={duplicate}>
                      <Icon name="copy" size={13} /> Duplicar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeElement(selected)}>
                      <Icon name="trash" size={13} /> Eliminar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Renderiza un elemento con su configuración real (o borrador).
function ElementSvg({ el, vars, selected }: { el: LabelElement; vars: Record<string, string>; selected: boolean }) {
  const S = (n?: number) => Math.round((n ?? 0) * SCALE);
  const sel = selected ? { stroke: "#1db954", strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const } : {};
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
  const setPos = (e: LabelElement, axis: "x" | "y", n: number) => (e.position = { ...(e.position ?? { x: 0, y: 0 }), [axis]: n });

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
    num("x", "X", (e) => e.position?.x, (e, n) => setPos(e, "x", n));
    num("y", "Y", (e) => e.position?.y, (e, n) => setPos(e, "y", n));
  } else if (el.type === "rectangle") {
    num("x", "X", (e) => e.position?.x, (e, n) => setPos(e, "x", n));
    num("y", "Y", (e) => e.position?.y, (e, n) => setPos(e, "y", n));
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
  // Nombre de capa (común)
  fields.push({
    key: "label", label: "Nombre de capa", type: "text",
    get: (e) => e.label ?? "",
    set: (e, v) => (e.label = String(v) || undefined),
  });

  const set = (f: FieldDef, v: string | number | boolean) => {
    const copy = JSON.parse(JSON.stringify(el)) as LabelElement;
    f.set(copy, v);
    onChange(copy);
  };

  const numeric = fields.filter((f) => f.type === "number");
  const rest = fields.filter((f) => f.type !== "number");

  return (
    <>
      {rest.map((f) => (
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
            <input type="text" value={String(f.get(el))} onChange={(e) => set(f, e.target.value)} />
          )}
        </div>
      ))}
      {numeric.length > 0 && (
        <div className="prop-grid">
          {numeric.map((f) => (
            <div className="prop-row" key={f.key}>
              <label>{f.label}</label>
              <input type="number" value={String(f.get(el))} onChange={(e) => set(f, Number(e.target.value))} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
