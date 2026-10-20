"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePresence } from "@/components/PresenceProvider";

type P = { id: string; username: string; display_name: string | null; avatar_url: string | null; presence: string };
type F = { id: string; status: "pending" | "accepted"; requester_id: string; addressee_id: string; requester: P; addressee: P };
const dot: Record<string, string> = { online: "bg-emerald-500", away: "bg-amber-400", dnd: "bg-red-500" };

export default function Friends({ meId }: { meId: string }) {
  const sb = supabaseBrowser(); const router = useRouter(); const pm = usePresence().map;
  const [rows, setRows] = useState<F[]>([]); const [q, setQ] = useState(""); const [res, setRes] = useState<P[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const cols = "id, username, display_name, avatar_url, presence";

  const load = useCallback(async () => {
    const { data } = await sb.from("friendships")
      .select(`id, status, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(${cols}), addressee:profiles!friendships_addressee_id_fkey(${cols})`);
    setRows((data as any) ?? []);
  }, []); // eslint-disable-line

  useEffect(() => {
    load(); loadBlocked(); loadSugg();
    const ch = sb.channel("friendships").on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, load).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load]); // eslint-disable-line

  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(async () => {
      const safe = q.trim().replace(/[%_,]/g, "");
      const { data } = await sb.from("profiles").select(cols).ilike("username", `${safe}%`).neq("id", meId).limit(10);
      setRes((data as any) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  const other = (f: F) => (f.requester_id === meId ? f.addressee : f.requester);
  const friends = rows.filter((f) => f.status === "accepted");
  const incoming = rows.filter((f) => f.status === "pending" && f.addressee_id === meId);
  const outgoing = rows.filter((f) => f.status === "pending" && f.requester_id === meId);

  async function add(id: string) {
    const { error } = await sb.from("friendships").insert({ requester_id: meId, addressee_id: id });
    setMsg(error ? (error.code === "23505" ? "Já existe uma solicitação ou amizade com este usuário." : "Não foi possível enviar a solicitação.") : "Solicitação enviada.");
  }
  async function accept(id: string) { await sb.from("friendships").update({ status: "accepted" }).eq("id", id); }
  async function remove(id: string) { await sb.from("friendships").delete().eq("id", id); }
  async function dm(id: string) {
    const { data, error } = await sb.rpc("start_dm", { other: id });
    if (error) return setMsg(error.message.includes("blocked") ? "Você não pode enviar mensagem a este usuário." : error.message.includes("not allowed") ? "Este usuário não aceita mensagens suas." : error.message);
    router.push(`/app/dm/${data}`); router.refresh();
  }
  const [sugg, setSugg] = useState<any[]>([]); const [grp, setGrp] = useState<{ open: boolean; name: string; sel: string[] }>({ open: false, name: "", sel: [] });
  async function loadSugg() { const { data } = await sb.rpc("suggest_friends"); setSugg((data as any[]) ?? []); }
  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (grp.sel.length < 2) return setMsg("Escolha ao menos 2 amigos para o grupo.");
    const { data, error } = await sb.rpc("create_group_dm", { p_name: grp.name, p_members: grp.sel });
    if (error) return setMsg(error.message.includes("invalid size") ? "Um grupo comporta de 3 a 10 pessoas." : "Não foi possível criar o grupo.");
    router.push(`/app/dm/${data}`); router.refresh();
  }
  const [blocked, setBlocked] = useState<any[]>([]);
  async function loadBlocked() {
    const { data } = await sb.from("blocked_users").select("blocked_id, profiles!blocked_users_blocked_id_fkey(id, username, display_name)").eq("blocker_id", meId);
    setBlocked((data as any[]) ?? []);
  }
  async function block(id: string) {
    if (!confirm("Bloquear este usuário? A amizade (se houver) será removida.")) return;
    const { error } = await sb.rpc("block_user", { target: id });
    setMsg(error ? "Não foi possível bloquear." : "Usuário bloqueado."); load(); loadBlocked();
  }
  async function unblock(id: string) { await sb.from("blocked_users").delete().eq("blocker_id", meId).eq("blocked_id", id); loadBlocked(); }
  async function reportUser(id: string) {
    const reason = prompt("Motivo da denúncia"); if (!reason?.trim()) return;
    const { error } = await sb.rpc("report_content", { p_type: "user", p_target: id, p_reason: reason.trim() });
    setMsg(error ? (error.code === "23505" ? "Você já denunciou este usuário." : "Não foi possível enviar a denúncia.") : "Denúncia enviada. Obrigado.");
  }
  const Row = ({ p, children }: { p: P; children: React.ReactNode }) => (
    <li className="flex items-center gap-3 rounded-lg border border-nx-line bg-nx-panel p-3">
      <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-violet-700">
        {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" /> : p.username[0].toUpperCase()}
        <i className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-nx-panel ${dot[pm.get(p.id) ?? ""] ?? "bg-zinc-600"}`} />
      </span>
      <Link href={`/app/u/${p.username}`} className="min-w-0 flex-1 truncate hover:underline">{p.display_name ?? p.username} <span className="text-xs text-zinc-500">@{p.username}</span></Link>
      <span className="flex gap-2 text-sm">{children}</span>
    </li>
  );
  const B = (p: any) => <button {...p} className="rounded-md border border-nx-line px-2 py-1 hover:bg-white/10" />;
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-bold">Amigos</h1>
      <div className="space-y-2">
        <input className="nx-input" placeholder="Buscar usuário pelo nome…" value={q} onChange={(e) => setQ(e.target.value)} />
        {msg && <p className="text-sm text-zinc-300" role="status">{msg}</p>}
        <ul className="space-y-2">{res.map((p) => <Row key={p.id} p={p}><B onClick={() => add(p.id)}>Adicionar</B><B onClick={() => dm(p.id)}>Mensagem</B><B onClick={() => block(p.id)}>Bloquear</B><B onClick={() => reportUser(p.id)}>Denunciar</B></Row>)}</ul>
      </div>
      {incoming.length > 0 && <section><h2 className="mb-2 text-sm text-zinc-400">Recebidas ({incoming.length})</h2>
        <ul className="space-y-2">{incoming.map((f) => <Row key={f.id} p={other(f)}><B onClick={() => accept(f.id)}>Aceitar</B><B onClick={() => remove(f.id)}>Recusar</B></Row>)}</ul></section>}
      {outgoing.length > 0 && <section><h2 className="mb-2 text-sm text-zinc-400">Enviadas</h2>
        <ul className="space-y-2">{outgoing.map((f) => <Row key={f.id} p={other(f)}><B onClick={() => remove(f.id)}>Cancelar</B></Row>)}</ul></section>}
      <section><h2 className="mb-2 text-sm text-zinc-400">Seus amigos ({friends.length})</h2>
        {friends.length === 0 && <p className="text-sm text-zinc-500">Busque um usuário acima para começar.</p>}
        <ul className="space-y-2">{friends.map((f) => <Row key={f.id} p={other(f)}><B onClick={() => dm(other(f).id)}>Mensagem</B><B onClick={() => confirm("Remover amigo?") && remove(f.id)}>Remover</B><B onClick={() => block(other(f).id)}>Bloquear</B><B onClick={() => reportUser(other(f).id)}>Denunciar</B></Row>)}</ul></section>
      {sugg.length > 0 && <section><h2 className="mb-2 text-sm text-zinc-400">Sugestões (amigos em comum)</h2>
        <ul className="space-y-2">{sugg.map((s: any) => <Row key={s.id} p={{ ...s, presence: "offline" }}><span className="text-xs text-zinc-500">{s.mutual} em comum</span><B onClick={() => add(s.id)}>Adicionar</B></Row>)}</ul></section>}
      {friends.length >= 2 && <section><button className="text-sm text-violet-400" onClick={() => setGrp({ ...grp, open: !grp.open })}>＋ Novo grupo</button>
        {grp.open && <form onSubmit={createGroup} className="mt-2 space-y-2 rounded-lg border border-nx-line bg-nx-panel p-3">
          <input className="nx-input" placeholder="Nome do grupo (opcional)" maxLength={64} value={grp.name} onChange={(e) => setGrp({ ...grp, name: e.target.value })} />
          {friends.map((f) => { const o = other(f); return <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grp.sel.includes(o.id)}
            onChange={(e) => setGrp({ ...grp, sel: e.target.checked ? [...grp.sel, o.id] : grp.sel.filter((x) => x !== o.id) })} />@{o.username}</label>; })}
          <button className="nx-btn !py-1 text-sm">Criar grupo</button></form>}</section>}
      {blocked.length > 0 && <section><h2 className="mb-2 text-sm text-zinc-400">Bloqueados ({blocked.length})</h2>
        <ul className="space-y-2">{blocked.map((b: any) => <li key={b.blocked_id} className="flex items-center justify-between rounded-lg border border-nx-line bg-nx-panel p-3 text-sm">
          <span>{b.profiles?.display_name ?? b.profiles?.username} <span className="text-xs text-zinc-500">@{b.profiles?.username}</span></span>
          <B onClick={() => unblock(b.blocked_id)}>Desbloquear</B></li>)}</ul></section>}
    </div>
  );
}
