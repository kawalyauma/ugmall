import { SessionGate } from "@/components/session";

export const metadata = { title: "Rider" };

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
