"use client";

import { useRef } from "react";
import { CreditCard, X } from "lucide-react";

export function PesaPalFrame({ src, onClose, onReturn }: { src: string; onClose: () => void; onReturn: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);

  function handleLoad() {
    try {
      const location = frame.current?.contentWindow?.location;
      if (location?.origin === window.location.origin && location.pathname.startsWith("/orders/")) onReturn();
    } catch {
      // The PesaPal page is cross-origin until it returns to our order page.
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Secure PesaPal card payment">
      <div className="flex h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[min(820px,92dvh)] sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-100 text-brand-700"><CreditCard className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">Secure card payment</div>
            <div className="text-xs text-gray-500">Powered by PesaPal · You stay on UG Mall</div>
          </div>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-gray-500 hover:bg-gray-100" aria-label="Close payment"><X className="size-5" /></button>
        </div>
        <iframe ref={frame} src={src} title="PesaPal secure card payment" onLoad={handleLoad} className="min-h-0 flex-1 border-0 bg-white" allow="payment" />
      </div>
    </div>
  );
}
