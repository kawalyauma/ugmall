"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Clock3, Copy, Heart, MapPin, PackageCheck, PackageOpen, ReceiptText, Truck, UserRound } from "lucide-react";
import { formatUGX } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Address { id:string; label:string | null; district:string; area:string; address:string; nearbyPlace:string | null; isDefault:boolean }
interface Buyer { id:string; name:string; phone:string; altPhone:string | null; email:string | null; addresses:Address[] }
interface MyOrder { orderNumber:string; statusLabel:string; status:string; paymentStatus:string; paymentMethod:string; deliveryMethod:string; total:number; amountPaid:number; createdAt:string; updatedAt:string; itemCount:number; firstImage:string | null }
interface OrdersResponse { summary:{ totalOrders:number; openOrders:number; deliveredOrders:number; totalSpent:number }; pagination:{ total:number; limit:number; offset:number }; orders:MyOrder[] }
interface CampaignProduct { id:string; name:string; slug:string; price:number; image:{ thumb:string | null; url:string | null } | null }
interface PersonalCampaign { id:string; title:string; code:string; percentOff:number; maxDiscount:number | null; startsAt:string; endsAt:string; used:boolean; products:CampaignProduct[] }

function GuestDashboard({data}:{data:OrdersResponse|null}) {
  const orders=data?.orders??[];
  return <div className="container-page space-y-6 py-5">
    <section className="rounded-3xl bg-gradient-to-r from-brand-800 to-emerald-600 p-5 text-white shadow-lg">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white/15"><PackageOpen className="size-6"/></span><div><h1 className="text-xl font-black">Your orders on this browser</h1><p className="text-sm text-white/80">No account required. UG Mall remembers this device securely.</p></div></div>
    </section>
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section><div className="mb-3"><h2 className="text-lg font-bold">Order history</h2><p className="text-xs text-gray-500">Orders made from this browser appear here automatically.</p></div>
        {!data&&<div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-400">Loading this device…</div>}
        {data&&orders.length===0&&<div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><ReceiptText className="mx-auto mb-2 size-8 text-gray-300"/><p className="text-sm text-gray-600">No orders have been made on this browser yet.</p><Link href="/" className="mt-3 inline-block text-sm font-bold text-brand-700">Start shopping</Link></div>}
        <div className="space-y-3">{orders.map((o)=><Link key={o.orderNumber} href={`/orders/${o.orderNumber}`} className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 hover:border-brand-300 hover:shadow-sm"><div className="size-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">{o.firstImage&&<img src={o.firstImage} alt="" className="size-full object-cover"/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-bold">{o.orderNumber}</span><span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">{o.statusLabel}</span></div><div className="mt-1 text-xs text-gray-500">{new Date(o.createdAt).toLocaleDateString("en-UG")} · {o.itemCount} item(s)</div><div className="mt-1 text-sm font-black">{formatUGX(o.total)}</div></div><ChevronRight className="size-5 text-gray-300"/></Link>)}</div>
      </section>
      <aside className="rounded-2xl border border-gray-200 bg-white px-5"><Login/></aside>
    </div>
  </div>;
}

function Login() {
  const { refreshCustomer, toast } = useStore();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  async function requestCode() {
    setBusy(true);
    try { const r=await api<{devCode?:string}>("/store/account/otp/request",{body:{phone}}); setStep("code"); toast(r.devCode?`Dev code: ${r.devCode}`:"We sent a 6-digit code to your WhatsApp"); }
    catch(e){ toast((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true);
    try { await api("/store/account/otp/verify",{body:{phone,code,name:name||undefined}}); await refreshCustomer(); if(next) router.push(next); }
    catch(e){ toast((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-sm space-y-4 py-10">
    <h1 className="text-2xl font-bold">Your UG Mall account</h1>
    <p className="text-sm text-gray-600">Sign in with your WhatsApp number to keep your orders, saved details, wishlist and personal offers together.</p>
    {step==="phone"?<>
      <Field label="Phone number"><Input value={phone} onChange={(e)=>setPhone(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" /></Field>
      <Field label="Your name (first time only)"><Input value={name} onChange={(e)=>setName(e.target.value)} /></Field>
      <Button size="lg" className="w-full" onClick={requestCode} loading={busy}>Send code on WhatsApp</Button>
    </>:<>
      <Field label="6-digit code"><Input value={code} onChange={(e)=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" /></Field>
      <Button size="lg" className="w-full" onClick={verify} loading={busy} disabled={code.length!==6}>Verify &amp; sign in</Button>
      <button className="w-full text-sm text-gray-500" onClick={()=>setStep("phone")}>Change number</button>
    </>}
  </div>;
}

const timeLeft = (end:string, now:number) => {
  const seconds=Math.max(0,Math.floor((new Date(end).getTime()-now)/1000));
  const h=Math.floor(seconds/3600); const m=Math.floor((seconds%3600)/60); const s=seconds%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
};

export default function AccountPage() {
  const { customer, refreshCustomer, toast } = useStore();
  const [buyer,setBuyer]=useState<Buyer|null>(null);
  const [orders,setOrders]=useState<OrdersResponse|null>(null);
  const [campaign,setCampaign]=useState<PersonalCampaign|null>(null);
  const [guestOrders,setGuestOrders]=useState<OrdersResponse|null>(null);
  const [now,setNow]=useState(Date.now());
  const [filter,setFilter]=useState<"all"|"active"|"delivered"|"cancelled">("all");
  const [profile,setProfile]=useState({name:"",altPhone:"",email:""});
  const [saving,setSaving]=useState(false);

  async function load(offset=0,append=false){
    if(!customer)return;
    const [me,orderData,offer]=await Promise.all([api<Buyer>("/store/account/me"),api<OrdersResponse>(`/store/account/orders?limit=20&offset=${offset}`),api<PersonalCampaign|null>("/store/account/promotion")]);
    setBuyer(me); setProfile({name:me.name,altPhone:me.altPhone?`0${me.altPhone.slice(3)}`:"",email:me.email??""});
    setOrders((old)=>append&&old?{...orderData,orders:[...old.orders,...orderData.orders]}:orderData); setCampaign(offer);
  }
  useEffect(()=>{
    if(customer) void load();
    else if(customer===null) api<OrdersResponse>("/store/account/device-orders").then(setGuestOrders,()=>setGuestOrders({summary:{totalOrders:0,openOrders:0,deliveredOrders:0,totalSpent:0},pagination:{total:0,limit:20,offset:0},orders:[]}));
  },[customer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[]);
  const visible=useMemo(()=>orders?.orders.filter((o)=>filter==="all"||(filter==="active"?!["delivered","cancelled","returned","refunded"].includes(o.status):o.status===filter))??[],[orders,filter]);
  async function saveProfile(){setSaving(true);try{await api("/store/account/profile",{method:"PATCH",body:profile});await refreshCustomer();await load();toast("Your details were saved");}catch(e){toast((e as Error).message);}finally{setSaving(false);}}

  if(customer===undefined)return <div className="py-16 text-center text-gray-400">Loading…</div>;
  if(!customer)return <GuestDashboard data={guestOrders}/>;
  const s=orders?.summary;
  return <div className="container-page space-y-6 py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-brand-700">Buyer dashboard</p><h1 className="text-2xl font-black">Hi, {customer.name.split(" ")[0]}</h1><p className="text-sm text-gray-500">Everything you buy stays here.</p></div><Button variant="secondary" size="sm" onClick={async()=>{await api("/store/account/logout",{method:"POST"});await refreshCustomer();}}>Sign out</Button></div>

    {campaign&&!campaign.used&&<section className="overflow-hidden rounded-3xl bg-gradient-to-r from-brand-800 via-brand-700 to-emerald-600 text-white shadow-lg">
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center"><div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold"><Clock3 className="size-4"/> YOUR PRIVATE OFFER</div><h2 className="text-xl font-black">{campaign.title}</h2><p className="mt-1 text-sm text-white/85">Save {campaign.percentOff}% on your selected picks, capped at {formatUGX(campaign.maxDiscount??0)}. Only your account can use it.</p></div><div className="rounded-2xl bg-black/20 p-3 text-center"><div className="text-xs text-white/70">Ends in</div><div className="font-mono text-2xl font-black tracking-wider">{timeLeft(campaign.endsAt,now)}</div></div></div>
      <div className="flex gap-3 overflow-x-auto bg-white/10 p-4">{campaign.products.slice(0,6).map((p)=><Link key={p.id} href={`/p/${p.slug}`} className="w-36 shrink-0 rounded-2xl bg-white p-2 text-gray-900"><div className="aspect-square overflow-hidden rounded-xl bg-gray-100">{p.image&&<img src={p.image.thumb??p.image.url??""} alt="" className="size-full object-cover"/>}</div><div className="mt-2 line-clamp-2 text-xs font-semibold">{p.name}</div><div className="mt-1 text-xs font-black text-brand-700">{formatUGX(p.price)}</div></Link>)}</div>
      <button onClick={async()=>{await navigator.clipboard.writeText(campaign.code);toast("Personal code copied");}} className="flex w-full items-center justify-center gap-2 border-t border-white/15 px-4 py-3 text-sm font-bold hover:bg-white/10"><Copy className="size-4"/> Code: {campaign.code} · copy for checkout</button>
    </section>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{label:"All orders",value:s?.totalOrders??0,icon:ReceiptText},{label:"In progress",value:s?.openOrders??0,icon:Truck},{label:"Delivered",value:s?.deliveredOrders??0,icon:PackageCheck},{label:"Total purchased",value:formatUGX(s?.totalSpent??0),icon:PackageOpen}].map((x)=><div key={x.label} className="rounded-2xl border border-gray-200 bg-white p-4"><x.icon className="mb-3 size-5 text-brand-700"/><div className="text-xl font-black">{x.value}</div><div className="text-xs text-gray-500">{x.label}</div></div>)}</div>

    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">My orders</h2><p className="text-xs text-gray-500">Open an order for live tracking, payment, cancellation, delivery and returns.</p></div><Link href="/track" className="text-sm font-bold text-brand-700">Track another order</Link></div>
        <div className="mb-3 flex gap-2 overflow-x-auto">{(["all","active","delivered","cancelled"] as const).map((f)=><button key={f} onClick={()=>setFilter(f)} className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-bold capitalize",filter===f?"bg-brand-700 text-white":"bg-gray-100 text-gray-600")}>{f}</button>)}</div>
        {!orders&&<div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-400">Loading your orders…</div>}
        {orders&&visible.length===0&&<div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><PackageOpen className="mx-auto mb-2 size-8 text-gray-300"/><p className="text-sm text-gray-500">No orders in this section.</p><Link href="/" className="mt-2 inline-block text-sm font-bold text-brand-700">Start shopping</Link></div>}
        <div className="space-y-3">{visible.map((o)=><Link key={o.orderNumber} href={`/orders/${o.orderNumber}`} className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm"><div className="size-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">{o.firstImage&&<img src={o.firstImage} alt="" className="size-full object-cover"/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-bold">{o.orderNumber}</span><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold",o.status==="cancelled"?"bg-red-50 text-red-700":o.status==="delivered"?"bg-green-50 text-green-700":"bg-brand-50 text-brand-700")}>{o.statusLabel}</span></div><div className="mt-1 text-xs text-gray-500">{new Date(o.createdAt).toLocaleDateString("en-UG",{day:"numeric",month:"short",year:"numeric"})} · {o.itemCount} item(s) · payment {o.paymentStatus.replaceAll("_"," ")}</div><div className="mt-1 text-sm font-black">{formatUGX(o.total)}</div></div><ChevronRight className="size-5 text-gray-300 group-hover:text-brand-700"/></Link>)}</div>
        {orders&&orders.orders.length<orders.pagination.total&&<Button variant="secondary" className="mt-4 w-full" onClick={()=>void load(orders.orders.length,true)}>Load older orders</Button>}
      </section>

      <aside className="space-y-4"><section className="rounded-2xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center gap-2 font-bold"><UserRound className="size-5 text-brand-700"/> Saved details</div><div className="space-y-3"><Field label="Name"><Input value={profile.name} onChange={(e)=>setProfile({...profile,name:e.target.value})}/></Field><Field label="Alternative phone"><Input value={profile.altPhone} onChange={(e)=>setProfile({...profile,altPhone:e.target.value})} inputMode="tel"/></Field><Field label="Email"><Input value={profile.email} onChange={(e)=>setProfile({...profile,email:e.target.value})} type="email"/></Field><Button size="sm" onClick={saveProfile} loading={saving}>Save details</Button></div></section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center gap-2 font-bold"><MapPin className="size-5 text-brand-700"/> Saved addresses</div>{!buyer?.addresses.length?<p className="text-sm text-gray-500">Your checkout addresses will appear here.</p>:<div className="space-y-2">{buyer.addresses.map((a)=><div key={a.id} className="rounded-xl bg-gray-50 p-3 text-sm"><div className="font-semibold">{a.label||a.area}{a.isDefault&&<span className="ml-2 text-xs text-brand-700">Default</span>}</div><div className="text-xs text-gray-500">{a.address}, {a.area}, {a.district}</div></div>)}</div>}</section>
        <Link href="/account/wishlist" className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 font-bold"><Heart className="size-5 text-red-500"/> My wishlist <ChevronRight className="ml-auto size-5 text-gray-300"/></Link>
      </aside>
    </div>
  </div>;
}
