"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

const TABS = [["messages", "Mensagens"], ["dms", "Conversas"], ["users", "Usuários"], ["servers", "Servidores"], ["channels", "Canais"], ["files", "Arquivos"]] as const;
type Item = { key: string; title: string; sub?: string; href?: string; action?: () => void };

// Todas as consultas passam pelo RLS: só aparece o que o usuário já tem permissão de ver.
export default function Search() {
  const sb = supabaseBrowser(); const router = useRouter();
  const [q, setQ] = useState(""); const [tab, setTab] = useState<(typeof TABS)[number][0]>("messages");
  const [page, setPage] = useState(0); const [items, setItems] = useState<Item[]>([]); const [loading, setLoading] = useState(false);
  const PER = 15;

  useEffect(() => {
    const term = q.trim().replace(/[%_,()*\\]/g, "");
    if (term.length < 2) { setItems([]); return; }
    const t = setTimeout(async () => {
      setLoading(true); const from = page * PER, to = from + PER - 1; const like = `%${term}%`;
      const snip = (s: string | null) => (s ?? "").slice(0, 120);
      let out: Item[] = [];
      if (tab === "messages") {
        const { data } = await sb.from("channel_messages").select("id, content, created_at, channel_id, profiles(username), channels(name, server_id, servers(name))")
          .ilike("content", like).is("deleted_at", null).order("created_at", { ascending: false }).range(from, to);
        out = (data ?? []).map((m: any) => ({ key: m.id, title: snip(m.content), sub: `@${m.profiles?.username} · #${m.channels?.name} · ${m.channels?.servers?.name}`, href: `/app/server/${m.channels?.server_id}/c/${m.channel_id}` }));
      } else if (tab === "dms") {
        const { data } = await sb.from("direct_messages").select("id, content, conversation_id, profiles(username)")
          .ilike("content", like).is("deleted_at", null).order("created_at", { ascending: false }).range(from, to);
        out = (data ?? []).map((m: any) => ({ key: m.id, title: snip(m.content), sub: `@${m.profiles?.username}`, href: `/app/dm/${m.conversation_id}` }));
      } else if (tab === "users") {
        const { data } = await sb.from("profiles").select("id, username, display_name").or(`username.ilike.${like},display_name.ilike.${like}`).range(from, to);
        out = (data ?? []).map((u: any) => ({ key: u.id, title: u.display_name ?? u.username, sub: `@${u.username}`,
          action: async () => { const r = await sb.rpc("start_dm", { other: u.id }); if (!r.error) { router.push(`/app/dm/${r.data}`); router.refresh(); } } }));
      } else if (tab === "servers") {
        const { data } = await sb.from("servers").select("id, name, description").or(`name.ilike.${like},description.ilike.${like}`).range(from, to);
        out = (data ?? []).map((s: any) => ({ key: s.id, title: s.name, sub: snip(s.description), href: `/app/server/${s.id}` }));
      } else if (tab === "channels") {
        const { data } = await sb.from("channels").select("id, name, topic, server_id, servers(name)").ilike("name", like).range(from, to);
        out = (data ?? []).map((c: any) => ({ key: c.id, title: `#${c.name}`, sub: c.servers?.name, href: `/app/server/${c.server_id}/c/${c.id}` }));
      } else {
        const { data } = await sb.from("message_attachments").select("id, file_name, size_bytes, channel_messages(channel_id, channels(server_id)), direct_messages(conversation_id)")
          .ilike("file_name", like).range(from, to);
        out = (data ?? []).map((a: any) => ({ key: a.id, title: a.file_name, sub: `${Math.ceil(a.size_bytes / 1024)} KB`,
          href: a.direct_messages ? `/app/dm/${a.direct_messages.conversation_id}` : `/app/server/${a.channel_messages?.channels?.server_id}/c/${a.channel_messages?.channel_id}` }));
      }
      setItems(out); setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab, page]); // eslint-disable-line

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Buscar</h1>
      <input className="nx-input" autoFocus placeholder="Digite ao menos 2 caracteres…" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} />
      <div className="flex flex-wrap gap-2 text-sm">{TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setPage(0); }}
        className={`rounded-full border px-3 py-1 ${tab === k ? "border-violet-400 bg-violet-500/20" : "border-nx-line"}`}>{l}</button>)}</div>
      {loading && <p className="text-sm text-zinc-500">Buscando…</p>}
      {!loading && q.trim().length >= 2 && items.length === 0 && <p className="text-sm text-zinc-500">Nada encontrado.</p>}
      <ul className="space-y-2">{items.map((i) => <li key={i.key} className="rounded-lg border border-nx-line bg-nx-panel p-3">
        {i.href ? <Link href={i.href} className="block"><p className="text-sm">{i.title}</p><p className="text-xs text-zinc-500">{i.sub}</p></Link>
          : <button onClick={i.action} className="block w-full text-left"><p className="text-sm">{i.title}</p><p className="text-xs text-zinc-500">{i.sub} · Enviar mensagem</p></button>}
      </li>)}</ul>
      <div className="flex gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
        <button disabled={items.length < PER} onClick={() => setPage(page + 1)}>Próxima →</button></div>
    </div>
  );
}
