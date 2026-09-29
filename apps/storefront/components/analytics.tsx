"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const META_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (GA_ID && window.gtag) window.gtag("event", "page_view", { page_path: pathname });
    if (META_ID && window.fbq) window.fbq("track", "PageView");
  }, [pathname]);
  return (
    <>
      {GA_ID && <><Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" /><Script id="ugmall-ga4" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false});` }} /></>}
      {META_ID && <Script id="ugmall-meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_ID}');fbq('track','PageView');` }} />}
    </>
  );
}

const META_EVENTS: Record<string, string> = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };

export function trackCommerceEvent(name: "view_item" | "add_to_cart" | "begin_checkout" | "purchase", params: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, params);
  const metaName = META_EVENTS[name];
  if (metaName) {
    const items = Array.isArray(params.items) ? params.items as Array<Record<string, unknown>> : [];
    const eventId = typeof params.event_id === "string" ? params.event_id : undefined;
    const payload = { value: params.value, currency: params.currency ?? "UGX", content_ids: items.map((x) => x.item_id).filter(Boolean), content_type: "product", num_items: items.length };
    if (eventId) window.fbq?.("track", metaName, payload, { eventID: eventId });
    else window.fbq?.("track", metaName, payload);
  }
}
