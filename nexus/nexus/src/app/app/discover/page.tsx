"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type S = { id: string; name: string; description: string | null; icon_url: string | null; banner_url: string | null; member_count: number };

export default function Discover() {
  const sb = supabaseBrowser(); const router = useRouter();
  const [q, setQ] = useState(""); const [list, setList] = useState<S[]>([]); const [page, setPage] = useState(0);
  const [f, setF] = useState({ name: "", description: "", is_public: false }); const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const PER = 12;

  const load = useCallback(async () => {
    const { data } = await sb.rpc("discover_servers", { q: q.trim().replace(/[%_]/g, ""), lim: PER, off: page * PER });
    setList((data as S[]) ?? []);
  }, [q, page]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (f.name.trim().length < 2) return setMsg("Nome muito curto.");
    setBusy(true);
    const { data, error } = await sb.rpc("create_server", { p_name: f.name.trim(), p_description: f.description || null, p_is_public: f.is_public });
    setBusy(false);
    if (error) return setMsg(error.message.includes("limit") ? "Limite de servidores atingido." : "Não foi possível criar o servidor.");
    router.push(`/app/server/${data}`); router.refresh();
  }
  async function join(id: string) {
    const { error } = await sb.rpc("join_public_server", { sid: id });
    if (error) return setMsg(error.message.includes("banned") ? "Você foi banido deste servidor." : "Não foi possível entrar.");
    router.push(`/app/server/${id}`); router.refresh();
  }
  async function joinCode(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().split("/").pop()!;
    const { data, error } = await sb.rpc("join_server_by_invite", { p_code: c });
    if (error) return setMsg(error.message.includes("banned") ? "Você foi banido deste servidor." : "Convite inválido ou expirado.");
    router.push(`/app/server/${data}`); router.refresh();
  }
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4">
      {msg && <p role="status" className="text-sm text-amber-300">{msg}</p>}
      <section className="space-y-3"><h1 className="text-xl font-bold">Criar servidor</h1>
        <form onSubmit={create} className="space-y-2">
          <input className="nx-input" placeholder="Nome do servidor" value={f.name} maxLength={64} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <textarea className="nx-input" placeholder="Descrição (opcional)" maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_public} onChange={(e) => setF({ ...f, is_public: e.target.checked })} /> Servidor público (aparece na descoberta)</label>
          <button className="nx-btn" disabled={busy}>{busy ? "Criando…" : "Criar"}</button>
        </form></section>
      <section className="space-y-2"><h2 className="font-semibold">Tenho um convite</h2>
        <form onSubmit={joinCode} className="flex gap-2"><input className="nx-input" placeholder="Código ou link" value={code} onChange={(e) => setCode(e.target.value)} /><button className="nx-btn">Entrar</button></form></section>
      <section className="space-y-3"><h2 className="font-semibold">Descobrir comunidades</h2>
        <input className="nx-input" placeholder="Buscar por nome ou descrição…" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} />
        {list.length === 0 && <p className="text-sm text-zinc-500">Nenhum servidor público encontrado.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">{list.map((s) => (
          <li key={s.id} className="overflow-hidden rounded-xl border border-nx-line bg-nx-panel">
            <div className="h-16 bg-gradient-to-r from-violet-700 to-blue-700 bg-cover" style={s.banner_url ? { backgroundImage: `url(${s.banner_url})` } : undefined} />
            <div className="space-y-1 p-3"><p className="font-medium">{s.name}</p>
              <p className="line-clamp-2 text-sm text-zinc-400">{s.description}</p>
              <p className="text-xs text-zinc-500">{s.member_count} membro(s)</p>
              <button className="nx-btn mt-2 text-sm" onClick={() => join(s.id)}>Entrar</button></div>
          </li>))}</ul>
        <div className="flex gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
          <button disabled={list.length < PER} onClick={() => setPage(page + 1)}>Próxima →</button></div></section>
    </div>
  );
}
