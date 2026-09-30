"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@ugmall/shared";

/** Floating chat button that opens WhatsApp with the product already named, so staff know what the shopper is asking about. */
export function FloatingWhatsApp({ number, productName }: { number: string; productName: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.href.split("?")[0]!), []);
  if (!number) return null;
  const message = `Hi, I'm interested in: ${productName}${url ? `\n${url}` : ""}`;
  return (
    <a
      href={whatsappLink(number, message)}
      target="_blank"
      rel="noreferrer"
      aria-label="Ask about this product on WhatsApp"
      className="fixed bottom-24 right-4 z-30 flex items-center gap-2 rounded-full bg-whatsapp py-3 pl-3 pr-4 text-sm font-bold text-white shadow-lg animate-wa-pulse transition hover:scale-105 md:bottom-8 md:right-8"
    >
      <MessageCircle className="size-5 fill-white/20" />
      <span className="hidden sm:inline">Ask on WhatsApp</span>
      <span className="sm:hidden">Ask</span>
    </a>
  );
}
