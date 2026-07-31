// Cliente API del server Express (label-printer-studio/server).
// La URL base se guarda en localStorage (Ajustes) y por defecto apunta
// al server local que sirve la app.

import type {
  HealthInfo,
  ImportRow,
  Job,
  LabelTemplate,
  PrinterProfile,
  TemplateSummary,
} from "./types";

export function getBase(): string {
  return (localStorage.getItem("studio.serverUrl") ?? "").replace(/\/+$/, "");
}

export function setBase(url: string) {
  localStorage.setItem("studio.serverUrl", url.replace(/\/+$/, ""));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBase();
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  base: getBase,

  async health(): Promise<HealthInfo> {
    return req<HealthInfo>("/api/health");
  },

  async printers(): Promise<PrinterProfile[]> {
    return req<PrinterProfile[]>("/api/printers");
  },

  async fonts(): Promise<Record<string, { loaded: boolean; width: number }>> {
    return req<Record<string, { loaded: boolean; width: number }>>("/api/fonts");
  },

  async devices(): Promise<{ devices: string[]; current: string | null; platform: string }> {
    return req("/api/devices");
  },

  async setDevice(device: string): Promise<{ ok: boolean; device: string | null }> {
    return req("/api/device", { method: "POST", body: JSON.stringify({ device }) });
  },

  async templates(): Promise<TemplateSummary[]> {
    return req<TemplateSummary[]>("/api/templates");
  },

  async getTemplate(name: string): Promise<LabelTemplate> {
    return req<LabelTemplate>(`/api/templates/${encodeURIComponent(name)}`);
  },

  async saveTemplate(name: string, template: LabelTemplate): Promise<{ ok: boolean; name: string }> {
    return req<{ ok: boolean; name: string }>("/api/templates", {
      method: "POST",
      body: JSON.stringify({ name, template }),
    });
  },

  async print(
    template: string | LabelTemplate,
    variables: Record<string, string | number>,
    dryRun: boolean
  ): Promise<{ ok: boolean; bytes: number; mediaType: string; device: string; dryRun: boolean }> {
    return req("/api/print", {
      method: "POST",
      body: JSON.stringify({ template, variables, dryRun }),
    });
  },

  async startBatch(
    template: string,
    records: ImportRow[],
    dryRun: boolean
  ): Promise<{ ok: boolean; jobId: string }> {
    return req("/api/batch", {
      method: "POST",
      body: JSON.stringify({ template, records, dryRun }),
    });
  },

  async job(id: string): Promise<Job> {
    return req<Job>(`/api/batch/${id}`);
  },

  async cancelJob(id: string): Promise<{ ok: boolean }> {
    return req(`/api/batch/${id}/cancel`, { method: "POST" });
  },

  /** Suscripción SSE al progreso de un job. Devuelve función de cierre. */
  subscribeJob(id: string, onEvent: (job: Job) => void): () => void {
    const base = getBase();
    const es = new EventSource(`${base}/api/batch/${id}/events`);
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as Job);
      } catch {
        /* ignorar mensajes malformados */
      }
    };
    return () => es.close();
  },
};
