/**
 * Server components call the API directly on the internal network;
 * the browser goes through /api (Nginx in production, Next rewrites in dev).
 */
const INTERNAL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function serverGet<T>(path: string, opts: { revalidate?: number; cookie?: string } = {}): Promise<T> {
  const res = await fetch(`${INTERNAL}${path}`, {
    next: { revalidate: opts.revalidate ?? 30 },
    headers: opts.cookie ? { cookie: opts.cookie } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `API ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "ugmall" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong", res.status, data.details ?? data);
  return data;
}
