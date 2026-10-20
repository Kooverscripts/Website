"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase/client";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  username: z.string().regex(/^[a-zA-Z0-9_.]{3,32}$/, "3–32 caracteres: letras, números, _ ou ."),
  password: z.string().min(8, "Mínimo de 8 caracteres"),
});

export default function Signup() {
  const [f, setF] = useState({ email: "", username: "", password: "" });
  const [avail, setAvail] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();

  useEffect(() => {
    setAvail(null);
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(f.username)) return;
    const t = setTimeout(async () => {
      const { data } = await sb.rpc("is_username_available", { u: f.username });
      setAvail(Boolean(data));
    }, 350);
    return () => clearTimeout(t);
  }, [f.username]); // eslint-disable-line

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const r = schema.safeParse(f);
    if (!r.success) return setErr(r.error.issues[0].message);
    if (avail === false) return setErr("Nome de usuário já em uso.");
    setBusy(true);
    const { error } = await sb.auth.signUp({ email: f.email, password: f.password, options: {
      data: { username: f.username }, emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` } });
    setBusy(false);
    error ? setErr(error.message.includes("Database error") ? "Nome de usuário já em uso ou inválido." : error.message) : setDone(true);
  }
  if (done) return <main className="mx-auto max-w-sm p-6 pt-24"><p>Conta criada! Confirme seu e-mail para entrar.</p></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Criar conta</h1>
      <form onSubmit={submit} className="space-y-3">
        <input className="nx-input" type="email" placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        <div>
          <input className="nx-input" placeholder="Nome de usuário" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
          {avail !== null && <p className={`mt-1 text-xs ${avail ? "text-emerald-400" : "text-red-400"}`}>{avail ? "Disponível" : "Indisponível"}</p>}
        </div>
        <input className="nx-input" type="password" placeholder="Senha (mín. 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        <p className="text-xs text-zinc-500">Ao criar a conta você concorda com os <Link className="text-violet-400" href="/terms">Termos de Uso</Link> e a <Link className="text-violet-400" href="/privacy">Política de Privacidade</Link>.</p>
        <button className="nx-btn w-full" disabled={busy}>{busy ? "Criando…" : "Criar conta"}</button>
      </form>
      <p className="text-sm text-zinc-400">Já tem conta? <Link className="text-violet-400" href="/login">Entrar</Link></p>
    </main>
  );
}
