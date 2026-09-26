"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

interface Review {
  id: string;
  name: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  reply: string | null;
  images: string[];
  createdAt: string;
}

function Stars({ n, onPick }: { n: number; onPick?: (n: number) => void }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} onClick={() => onPick?.(i)} className={`size-4 ${i <= n ? "fill-accent text-accent" : "text-gray-300"} ${onPick ? "size-7 cursor-pointer" : ""}`} />
      ))}
    </span>
  );
}

export function Reviews({ productId, rating }: { productId: string; rating: { average: number; count: number } | null }) {
  const { customer, toast } = useStore();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(5);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Review[]>(`/store/products/${productId}/reviews`).then(setReviews, () => {});
  }, [productId]);

  async function submit() {
    setBusy(true);
    try {
      const imageIds: string[] = [];
      if (file) {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/store/account/review-images", { method: "POST", body: fd, credentials: "include", headers: { "X-Requested-With": "ugmall" } });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        imageIds.push(j.id);
      }
      const r = await api<{ message: string }>(`/store/account/products/${productId}/reviews`, { body: { rating: stars, body: text, imageIds } });
      toast(r.message);
      setOpen(false);
      setText("");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          Reviews {rating && <span className="ml-2 text-sm font-normal text-gray-500">{rating.average.toFixed(1)} ★ ({rating.count})</span>}
        </h2>
        {customer ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}>
            Write a review
          </Button>
        ) : (
          <Link href="/account" className="text-sm text-brand-700">
            Sign in to review
          </Link>
        )}
      </div>
      {open && (
        <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4">
          <Stars n={stars} onPick={setStars} />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="How was the fit, quality and delivery?" />
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <Button onClick={submit} loading={busy} disabled={text.trim().length < 3}>
            Submit review
          </Button>
        </div>
      )}
      <div className="mt-4 divide-y divide-gray-100">
        {reviews.length === 0 && <p className="text-sm text-gray-500">No reviews yet.</p>}
        {reviews.map((r) => (
          <div key={r.id} className="py-3">
            <div className="flex items-center gap-2 text-sm">
              <Stars n={r.rating} /> <span className="font-semibold">{r.name}</span>
              {r.verified && <span className="rounded bg-green-50 px-1.5 text-xs text-green-700">Verified purchase</span>}
            </div>
            {r.title && <div className="mt-1 font-medium">{r.title}</div>}
            <p className="mt-1 text-sm text-gray-700">{r.body}</p>
            {r.images.length > 0 && (
              <div className="mt-2 flex gap-2">
                {r.images.map((u) => (
                  <img key={u} src={u} alt="" className="size-16 rounded-lg object-cover" />
                ))}
              </div>
            )}
            {r.reply && <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-800">Shop reply: {r.reply}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
