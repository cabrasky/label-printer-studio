// ---- Tipos del dominio: plantillas, jobs, API del server --------------------

export interface TemplateSummary {
  name: string;
  description: string;
  dimensions: { width: number; height: number } | null;
}

export type ElementType = "text" | "rectangle" | "line" | "circle" | "stripes" | "grid";

export interface LabelElement {
  type: ElementType;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  weight?: string;
  align?: "left" | "center" | "right";
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  filled?: boolean;
  lineWidth?: number;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  spacing?: number;
  direction?: "vertical" | "horizontal";
  cellWidth?: number;
  cellHeight?: number;
  alpha?: number;
  /** Metadatos del editor (el core los ignora) */
  locked?: boolean;
  hidden?: boolean;
  label?: string;
}

export interface LabelTemplate {
  name?: string;
  description?: string;
  background?: "white" | "black";
  dimensions: { width: number; height: number };
  defaultFont?: { family: string; size: number };
  elements: LabelElement[];
}

export interface HealthInfo {
  ok: boolean;
  server: string;
  printer: {
    id: string;
    name: string;
    device: string | null;
    media: string;
  };
}

export interface PrinterProfile {
  id: string;
  name: string;
  aliases: string[];
  usb: { vendorId?: string; productId?: string };
  dpi: number;
  media: { types: string[]; defaultType: string };
  limits: { maxRasterWidth?: number; maxWidthPx?: number; maxHeightPx?: number };
}

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface JobError {
  index?: number;
  error: string;
}

export interface Job {
  id: string;
  label: string;
  status: JobStatus;
  dryRun: boolean;
  total: number;
  done: number;
  failed: number;
  currentIndex: number | null;
  errors: JobError[];
  createdAt: string;
  finishedAt: string | null;
}

export interface ImportRow {
  [column: string]: string | number;
}
