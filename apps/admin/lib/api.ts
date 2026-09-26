export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

const headers = { "X-Requested-With": "ugmall" };

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: init.body !== undefined ? { ...headers, "Content-Type": "application/json" } : headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/admin/auth")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.details);
  return data;
}

export async function upload<T = unknown>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers, body: fd });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
  return data;
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
