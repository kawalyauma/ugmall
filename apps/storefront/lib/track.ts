/**
 * Behaviour beacon for the "For You" engine. Events are batched and sent a
 * moment later (or when the tab is hidden) in one request; `keepalive` lets
 * the last batch survive navigation. Tracking never throws or blocks the UI.
 */
export type TrackEvent =
  | { type: "view" | "dwell"; productId: string }
  | { type: "search"; query: string }
  | { type: "category"; categorySlug: string };

let queue: TrackEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 30);
  void fetch("/api/store/events", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-Requested-With": "ugmall" },
    body: JSON.stringify({ events }),
  }).catch(() => {});
  if (queue.length) flush();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function track(e: TrackEvent) {
  if (typeof window === "undefined") return;
  queue.push(e);
  if (!timer) timer = setTimeout(flush, 1500);
}
