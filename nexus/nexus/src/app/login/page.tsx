"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setErr(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." :
      error.message.includes("not confirmed") ? "Confirme seu e-mail antes de entrar." : error.message);
    window.location.href = "/app";
  }
  async function reset() {
    if (!email) return setErr("Digite seu e-mail primeiro.");
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/settings/account` });
    error ? setErr(error.message) : setInfo("Enviamos um link de redefinição para seu e-mail.");
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-3xl font-bold text-transparent">NEXUS</h1>
      <form onSubmit={submit} className="space-y-3">
        <input className="nx-input" type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="nx-input" type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        <button className="nx-btn w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
      <button onClick={reset} className="text-sm text-zinc-400 hover:text-zinc-200">Esqueci minha senha</button>
      <p className="text-sm text-zinc-400">Novo aqui? <Link className="text-violet-400" href="/signup">Criar conta</Link></p>
    </main>
  );
}
