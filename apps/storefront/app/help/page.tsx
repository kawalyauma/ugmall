import { serverGet } from "@/lib/api";
import type { ShopSettings, Zone } from "@/lib/types";
import { formatUGX } from "@ugmall/shared";

export const metadata = { title: "Delivery, payment & returns" };

export default async function Help() {
  const [s, zones] = await Promise.all([serverGet<ShopSettings>("/store/settings"), serverGet<Zone[]>("/store/delivery-zones")]);
  return (
    <div className="container-page max-w-2xl space-y-6 py-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Delivery, payment &amp; returns</h1>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Delivery fees</h2>
        <table className="w-full overflow-hidden rounded-xl bg-white">
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className="border-b border-gray-100">
                <td className="p-2">{z.name}</td>
                <td className="p-2 text-right font-medium">{z.isCalculated ? "Calculated by weight" : formatUGX(z.fee ?? 0)}</td>
                <td className="p-2 text-right text-gray-500">{z.etaText}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">Pickup is free from {s.pickupAddress} ({s.pickupHours}).</p>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Payment</h2>
        <p>Pay securely with MTN Mobile Money or Airtel Money — you'll get a prompt on your phone to enter your PIN. You can also pay cash (or MoMo) to the rider on delivery, or at the shop on pickup.</p>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Returns</h2>
        <p>{s.returnPolicy}</p>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Contact</h2>
        <p>
          Call {s.supportPhone} or WhatsApp us — {s.businessHours}.
        </p>
      </section>
    </div>
  );
}
