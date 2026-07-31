// Estado global: servidor conectado, impresora activa, página actual y
// el job "ahora imprimiendo" (barra inferior estilo Spotify).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { HealthInfo, Job } from "./types";

export type Page = "home" | "designer" | "import" | "batch" | "settings";

interface StudioState {
  page: Page;
  setPage: (p: Page) => void;
  health: HealthInfo | null;
  connected: boolean;
  checking: boolean;
  checkHealth: () => Promise<void>;
  nowPlaying: Job | null;
  trackJob: (id: string) => () => void;
  refreshTick: number;
  bumpRefresh: () => void;
}

const Ctx = createContext<StudioState | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>("home");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<Job | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const unsubs = useRef<Array<() => void>>([]);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await api.health());
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const t = setInterval(() => void checkHealth(), 15000);
    return () => clearInterval(t);
  }, [checkHealth]);

  // Al navegar a "Lotes" se refresca la lista; cualquier página puede pedirlo.
  const bumpRefresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Seguimiento SSE de un job activo (barra "Now printing").
  const trackJob = useCallback((id: string) => {
    unsubs.current.forEach((u) => u());
    unsubs.current = [];
    const unsub = api.subscribeJob(id, (job) => {
      setNowPlaying(job);
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
        unsub();
        unsubs.current = unsubs.current.filter((u) => u !== unsub);
        setNowPlaying(null);
        setRefreshTick((n) => n + 1);
      }
    });
    unsubs.current.push(unsub);
    void api.job(id).then(setNowPlaying).catch(() => undefined);
    return unsub;
  }, []);

  useEffect(() => () => unsubs.current.forEach((u) => u()), []);

  return (
    <Ctx.Provider
      value={{ page, setPage, health, connected: !!health?.ok, checking, checkHealth, nowPlaying, trackJob, refreshTick, bumpRefresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStudio(): StudioState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudio fuera de StudioProvider");
  return s;
}
