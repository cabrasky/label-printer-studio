import { EventEmitter } from "node:events";

/**
 * Cola de impresión por lotes en memoria.
 * Procesa registros secuencialmente (una impresora imprime de uno en uno)
 * y emite eventos para progreso en vivo (SSE).
 */
export class PrintQueue {
  constructor() {
    this.jobs = new Map();
    this.emitter = new EventEmitter();
    this.jobSeq = 0;
  }

  /**
   * Crea un job y lo procesa en background.
   * @param {string} label - Nombre descriptivo (plantilla / usuario).
   * @param {Array<object>} records - Lista de objetos de variables (uno por etiqueta).
   * @param {(record: object, index: number) => Promise<void>} worker - Imprime un registro.
   * @param {{dryRun?: boolean, delayMs?: number}} opts
   * @returns {string} jobId
   */
  enqueue(label, records, worker, opts = {}) {
    const { dryRun = false, delayMs = 350 } = opts;
    const jobId = `job-${++this.jobSeq}`;
    const job = {
      id: jobId,
      label,
      status: "pending", // pending | running | done | failed | cancelled
      dryRun,
      total: records.length,
      done: 0,
      failed: 0,
      current: null,
      errors: [],
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.jobs.set(jobId, job);

    this._run(job, records, worker, delayMs).catch((e) => {
      job.status = "failed";
      job.errors.push(String(e?.message ?? e));
      job.finishedAt = new Date().toISOString();
      this.emitter.emit(jobId, this.snapshot(jobId));
    });
    return jobId;
  }

  async _run(job, records, worker, delayMs) {
    job.status = "running";
    this.emitter.emit(job.id, this.snapshot(job.id));
    for (let i = 0; i < records.length; i++) {
      if (job.status === "cancelled") break;
      job.current = { index: i, record: records[i] };
      this.emitter.emit(job.id, this.snapshot(job.id));
      try {
        await worker(records[i], i);
        job.done++;
      } catch (e) {
        job.failed++;
        job.errors.push({ index: i, error: String(e?.message ?? e) });
      }
      if (i < records.length - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      this.emitter.emit(job.id, this.snapshot(job.id));
    }
    job.current = null;
    job.status = job.failed > 0 && job.done === 0 ? "failed" : "done";
    job.finishedAt = new Date().toISOString();
    this.emitter.emit(job.id, this.snapshot(job.id));
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (job && (job.status === "pending" || job.status === "running")) {
      job.status = "cancelled";
      this.emitter.emit(jobId, this.snapshot(jobId));
      return true;
    }
    return false;
  }

  snapshot(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const { record, ...rest } = job.current ?? {};
    return {
      id: job.id,
      label: job.label,
      status: job.status,
      dryRun: job.dryRun,
      total: job.total,
      done: job.done,
      failed: job.failed,
      currentIndex: rest?.index ?? null,
      errors: job.errors,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
  }

  get(jobId) {
    return this.snapshot(jobId);
  }

  /** Suscripción a eventos de un job. Devuelve función para desuscribirse. */
  subscribe(jobId, cb) {
    this.emitter.on(jobId, cb);
    return () => this.emitter.off(jobId, cb);
  }
}
