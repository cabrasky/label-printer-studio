// Preview SVG fiel al renderer del core (render.mjs).
// Mismas constantes y mismo algoritmo: SCALE = dpi/scaleDpi, auto-fit de
// texto por ancho, mismos tipos de elemento. Las coordenadas del template
// están en unidades de diseño (px de impresora / SCALE), como en el core.

import type { JSX, MouseEvent as ReactMouseEvent } from "react";
import type { LabelElement, LabelTemplate } from "../types";

export const DPI = 203;
export const SCALE_DISPLAY = 96;
export const SCALE = DPI / SCALE_DISPLAY; // ≈ 2.115
export const TEXT_MARGIN_PX = 8;

let mctx: CanvasRenderingContext2D | null = null;

export function measureText(text: string, family: string, px: number, weight: string): number {
  if (!mctx) {
    mctx = document.createElement("canvas").getContext("2d");
  }
  if (!mctx) return text.length * px * 0.55;
  mctx.font = `${weight} ${px}px "${family}"`;
  return mctx.measureText(text).width;
}

/** Sustituye {{var}} con valores de preview legibles. */
export function previewVars(tpl: LabelTemplate): Record<string, string> {
  const vars = new Set<string>();
  for (const el of tpl.elements) {
    if (el.type !== "text" || !el.content) continue;
    for (const m of el.content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) vars.add(m[1]);
  }
  const out: Record<string, string> = {};
  for (const v of vars) out[v] = v.toUpperCase().slice(0, 12);
  return out;
}

export function substitute(content: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (r, [k, v]) => r.replace(new RegExp(`{{${k}}}`, "g"), String(v)),
    content
  );
}

interface RenderOpts {
  vars?: Record<string, string>;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
}

export function renderLabelSvg(tpl: LabelTemplate, opts: RenderOpts = {}): JSX.Element {
  const vars = opts.vars ?? previewVars(tpl);
  const dimW = tpl.dimensions?.width ?? 227;
  const dimH = tpl.dimensions?.height ?? 136;
  const bg = tpl.background === "black" ? "#000000" : "#ffffff";
  const ink = tpl.background === "black" ? "#ffffff" : "#000000";
  const defaultFamily = tpl.defaultFont?.family ?? "Norwester Condensed";
  const defaultSize = tpl.defaultFont?.size ?? 16;

  // Pass 1: auto-fit de texto (mismo criterio que render.mjs)
  const sizes = new Map<number, number>();
  tpl.elements.forEach((el, i) => {
    if (el.type !== "text") return;
    const text = substitute(el.content ?? "", vars);
    const family = el.fontFamily ?? defaultFamily;
    const base = el.fontSize ?? defaultSize;
    const x = Math.round((el.position?.x ?? 0) * SCALE);
    const avail = el.align === "center" ? dimW - 2 * TEXT_MARGIN_PX : dimW - x - TEXT_MARGIN_PX;
    const scaled = base * SCALE;
    const width = measureText(text, family, scaled, el.weight ?? "normal");
    sizes.set(
      i,
      width > avail ? Math.round(scaled * (avail / width) * 0.97) : Math.round(scaled)
    );
  });

  const elements = tpl.elements.map((el, i) =>
    renderElement(el, i, { ink, defaultFamily, defaultSize, dimW, dimH, sizes, selected: opts.selectedId === i, onSelect: opts.onSelect, vars })
  );

  return (
    <svg
      className="label-canvas"
      viewBox={`0 0 ${dimW} ${dimH}`}
      width={dimW}
      height={dimH}
      style={{ background: bg }}
    >
      <rect x={0} y={0} width={dimW} height={dimH} fill={bg} />
      {elements}
    </svg>
  );
}

interface ElCtx {
  ink: string;
  defaultFamily: string;
  defaultSize: number;
  dimW: number;
  dimH: number;
  sizes: Map<number, number>;
  selected: boolean;
  onSelect?: (id: number) => void;
  vars: Record<string, string>;
}

function renderElement(el: LabelElement, id: number, c: ElCtx): JSX.Element {
  const S = (n?: number) => Math.round((n ?? 0) * SCALE);
  const common = {
    "data-el": id,
    onClick: (e: ReactMouseEvent) => {
      e.stopPropagation();
      c.onSelect?.(id);
    },
  };
  const sel = c.selected
    ? { stroke: "#1db954", strokeWidth: 1 / SCALE, strokeDasharray: `${2 / SCALE} ${1.5 / SCALE}`, vectorEffect: "non-scaling-stroke" as const }
    : {};

  switch (el.type) {
    case "text": {
      const text = substitute(el.content ?? "", c.vars);
      const family = el.fontFamily ?? c.defaultFamily;
      const size = c.sizes.get(id) ?? S(el.fontSize ?? c.defaultSize);
      const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      return (
        <text
          key={id}
          {...common}
          x={S(el.position?.x)}
          y={S(el.position?.y)}
          fontSize={size}
          fontFamily={`"${family}"`}
          fontWeight={el.weight ?? "normal"}
          textAnchor={anchor}
          fill={c.ink}
          {...sel}
        >
          {text}
        </text>
      );
    }
    case "rectangle": {
      const filled = el.filled;
      return (
        <rect
          key={id}
          {...common}
          x={S(el.position?.x)}
          y={S(el.position?.y)}
          width={Math.max(0, S(el.width))}
          height={Math.max(0, S(el.height))}
          fill={filled ? c.ink : "none"}
          stroke={filled ? "none" : c.ink}
          strokeWidth={filled ? 0 : S(el.lineWidth ?? 1)}
          {...sel}
        />
      );
    }
    case "line": {
      return (
        <line
          key={id}
          {...common}
          x1={S(el.start?.x)}
          y1={S(el.start?.y)}
          x2={S(el.end?.x)}
          y2={S(el.end?.y)}
          stroke={c.ink}
          strokeWidth={S(el.width ?? 1)}
          {...sel}
        />
      );
    }
    case "circle": {
      const filled = el.filled;
      return (
        <circle
          key={id}
          {...common}
          cx={S(el.center?.x)}
          cy={S(el.center?.y)}
          r={Math.max(0, S(el.radius))}
          fill={filled ? c.ink : "none"}
          stroke={filled ? "none" : c.ink}
          strokeWidth={filled ? 0 : S(el.lineWidth ?? 1)}
          {...sel}
        />
      );
    }
    case "stripes": {
      const b = el.bounds
        ? { x: S(el.bounds.x), y: S(el.bounds.y), w: S(el.bounds.width), h: S(el.bounds.height) }
        : { x: 0, y: 0, w: c.dimW, h: c.dimH };
      const spacing = Math.max(1, S(el.spacing ?? 8));
      const sw = Math.max(1, S(el.width ?? 2));
      const rects: JSX.Element[] = [];
      if (el.direction === "horizontal") {
        for (let y = b.y; y < b.y + b.h; y += spacing) {
          rects.push(<rect key={y} x={b.x} y={y} width={b.w} height={Math.min(sw, b.y + b.h - y)} fill={c.ink} />);
        }
      } else {
        for (let x = b.x; x < b.x + b.w; x += spacing) {
          rects.push(<rect key={x} x={x} y={b.y} width={Math.min(sw, b.x + b.w - x)} height={b.h} fill={c.ink} />);
        }
      }
      return (
        <g key={id} {...common} {...sel}>
          {rects}
        </g>
      );
    }
    case "grid": {
      const b = el.bounds
        ? { x: S(el.bounds.x), y: S(el.bounds.y), w: S(el.bounds.width), h: S(el.bounds.height) }
        : { x: 0, y: 0, w: c.dimW, h: c.dimH };
      const cw = Math.max(1, S(el.cellWidth ?? 8));
      const ch = Math.max(1, S(el.cellHeight ?? 8));
      const lw = S(el.lineWidth ?? 1);
      const stroke = el.alpha ? `rgba(0,0,0,${el.alpha})` : c.ink;
      const lines: JSX.Element[] = [];
      for (let x = b.x; x <= b.x + b.w; x += cw) {
        lines.push(<line key={`v${x}`} x1={x} y1={b.y} x2={x} y2={b.y + b.h} stroke={stroke} strokeWidth={lw} />);
      }
      for (let y = b.y; y <= b.y + b.h; y += ch) {
        lines.push(<line key={`h${y}`} x1={b.x} y1={y} x2={b.x + b.w} y2={y} stroke={stroke} strokeWidth={lw} />);
      }
      return (
        <g key={id} {...common} {...sel}>
          {lines}
        </g>
      );
    }
    default:
      return <g key={id} />;
  }
}
