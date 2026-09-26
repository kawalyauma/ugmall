"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api<{ permissions: string[] }>("/admin/auth/login", { body: { email, password } });
      const riderOnly = !me.permissions.includes("*") && me.permissions.includes("rider.app") && !me.permissions.includes("dashboard.view");
      router.replace(riderOnly ? "/rider" : next && next.startsWith("/") ? next : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">Staff sign in</h1>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </Field>
      <Field label="Password">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-700 to-brand-800 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
