"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

/** fetch wrapper: JSON in/out, throws ApiError with the server's message. */
export async function call<T = unknown>(url: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    window.location.href = "/login";
    throw new ApiError("Session expired.", 401);
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const issues = data?.issues as { path: string; message: string }[] | undefined;
    const detail = issues?.length ? ` (${issues[0].path}: ${issues[0].message})` : "";
    throw new ApiError((data?.error ?? `Request failed (${res.status})`) + detail, res.status, issues);
  }
  return data as T;
}

export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    try {
      const d = await call<T>(url);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    setLoading(!!url);
    void load();
  }, [load, url]);

  useEffect(() => {
    if (!opts.refreshMs || !url) return;
    const t = setInterval(() => void load(), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, load, url]);

  return { data, error, loading, reload: load, setData };
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = useCallback(
    (n: T) => {
      setV(n);
      try {
        localStorage.setItem(key, JSON.stringify(n));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
