"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePresence } from "@/components/PresenceProvider";
import RolesPanel, { type RoleT } from "@/components/RolesPanel";

type Cat = { id: string; name: string; position: number };
type Ch = { id: string; name: string; type: string; category_id: string | null; position: number; is_private: boolean };
type Mem = { roleIds?: string[]; id: string; username: string; display_name: string | null; presence: string; role: string | null; color: string | null };
const icon: Record<string, string> = { text: "#", voice: "🔊", announcement: "📢", media: "🖼️" };
const dot: Record<string, string> = { online: "bg-emerald-500", away: "bg-amber-400", dnd: "bg-red-500" };

export default function ServerNav({ server, meId, isOwner, perms, categories, channels, members, roles, myTop, unreads }: {
  server: { id: string; name: string; is_public: boolean; owner_id: string; description?: string | null; rules?: string | null; icon_url?: string | null; banner_url?: string | null }; meId: string; isOwner: boolean; perms: string[];
  categories: Cat[]; channels: Ch[]; members: Mem[]; roles: RoleT[]; myTop: number; unreads: Record<string, number> }) {
  const sb = supabaseBrowser(); const router = useRouter(); const params = useParams<{ channelId?: string }>();
  const [open, setOpen] = useState(false); const [panel, setPanel] = useState<null | "invites" | "audit" | "settings" | "roles" | "access" | "reports">(null);
  const [reports, setReports] = useState<any[]>([]); const [srvMuted, setSrvMuted] = useState(false);
  const [accCh, setAccCh] = useState<Ch | null>(null); const [accPriv, setAccPriv] = useState(false); const [accRoles, setAccRoles] = useState<string[]>([]);
  const [invites, setInvites] = useState<any[]>([]); const [audit, setAudit] = useState<any[]>([]); const [msg, setMsg] = useState<string | null>(null);
  const has = (p: string) => perms.includes(p);

  useEffect(() => {
    const ch = sb.channel(`server:${server.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channels", filter: `server_id=eq.${server.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `server_id=eq.${server.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "server_members", filter: `server_id=eq.${server.id}` }, (p: any) => {
        if (p.eventType === "DELETE" && p.old?.user_id === meId) { router.push("/app/discover"); router.refresh(); } else router.refresh(); })
      // DELETE não aceita filtro no Realtime: escuta geral e confere no cliente
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "channels" }, () => router.refresh())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "categories" }, () => router.refresh())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "server_members" }, (p: any) => {
        if (p.old?.server_id !== server.id) return;
        if (p.old?.user_id === meId) { router.push("/app/discover"); router.refresh(); } else router.refresh(); })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [server.id]); // eslint-disable-line

  const fail = (e: any) => setMsg(e?.message?.includes("hierarchy") ? "Você não pode agir sobre um cargo igual ou superior ao seu." : e?.message?.includes("forbidden") || e?.code === "42501" ? "Você não tem permissão para isso." : "Ação não concluída.");
  async function newChannel(category_id: string | null) {
    const name = prompt("Nome do canal"); if (!name) return;
    const type = prompt("Tipo: text, voice, announcement ou media", "text") ?? "text";
    if (!["text", "voice", "announcement", "media"].includes(type)) return setMsg("Tipo inválido.");
    const clean = type === "voice" ? name.trim() : name.trim().toLowerCase().replace(/\s+/g, "-");
    const { error } = await sb.from("channels").insert({ server_id: server.id, category_id, name: clean.slice(0, 64), type, position: channels.length });
    error ? fail(error) : router.refresh();
  }
  async function newCategory() {
    const name = prompt("Nome da categoria"); if (!name) return;
    const { error } = await sb.from("categories").insert({ server_id: server.id, name: name.trim(), position: categories.length });
    error ? fail(error) : router.refresh();
  }
  async function renameChannel(c: Ch) {
    const name = prompt("Novo nome", c.name); if (!name) return;
    const { error } = await sb.from("channels").update({ name: name.trim() }).eq("id", c.id); error ? fail(error) : router.refresh();
  }
  async function delChannel(c: Ch) {
    if (!confirm(`Excluir #${c.name} e todas as mensagens?`)) return;
    const { error } = await sb.from("channels").delete().eq("id", c.id);
    if (error) return fail(error);
    if (params.channelId === c.id) router.push(`/app/server/${server.id}`); router.refresh();
  }
  async function delCategory(c: Cat) {
    if (!confirm(`Excluir a categoria "${c.name}"? Os canais ficam sem categoria.`)) return;
    const { error } = await sb.from("categories").delete().eq("id", c.id); error ? fail(error) : router.refresh();
  }
  async function openInvites() {
    setPanel("invites");
    const { data } = await sb.from("server_invites").select("code, uses, max_uses, expires_at").eq("server_id", server.id).eq("revoked", false);
    setInvites(data ?? []);
  }
  async function makeInvite() {
    const { error } = await sb.from("server_invites").insert({ server_id: server.id, created_by: meId, max_uses: 50, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
    error ? fail(error) : openInvites();
  }
  async function revoke(code: string) { await sb.from("server_invites").update({ revoked: true }).eq("code", code); openInvites(); }
  async function openAudit() {
    setPanel("audit");
    const { data } = await sb.from("moderation_actions").select("id, action, created_at, actor:profiles!moderation_actions_actor_id_fkey(username), target:profiles!moderation_actions_target_user_id_fkey(username)")
      .eq("server_id", server.id).order("created_at", { ascending: false }).limit(30);
    setAudit(data ?? []);
  }
  async function leave() {
    if (!confirm("Sair deste servidor?")) return;
    const { error } = await sb.rpc("leave_server", { sid: server.id });
    if (error) return setMsg(error.message.includes("owner") ? "O proprietário deve transferir a propriedade antes de sair." : "Não foi possível sair.");
    router.push("/app"); router.refresh();
  }
  async function member(action: "kick_member" | "ban_member" | "transfer_ownership", m: Mem) {
    const label = { kick_member: "Expulsar", ban_member: "Banir", transfer_ownership: "Transferir a propriedade para" }[action];
    if (!confirm(`${label} ${m.username}?`)) return;
    const args = action === "transfer_ownership" ? { sid: server.id, new_owner: m.id } : { sid: server.id, target: m.id };
    const { error } = await sb.rpc(action, args); error ? fail(error) : router.refresh();
  }
  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const d = new FormData(e.currentTarget);
    const { error } = await sb.from("servers").update({ name: String(d.get("name")).trim(), description: String(d.get("description")) || null, rules: String(d.get("rules")) || null, is_public: d.get("is_public") === "on" }).eq("id", server.id);
    error ? fail(error) : (setMsg("Salvo."), router.refresh());
  }
  async function delServer() {
    if (prompt(`Digite "${server.name}" para excluir o servidor permanentemente`) !== server.name) return;
    const { error } = await sb.from("servers").delete().eq("id", server.id);
    error ? fail(error) : (router.push("/app"), router.refresh());
  }
  const pm = usePresence().map;
  const [unread, setUnread] = useState<Record<string, number>>(unreads);
  const chRef = useRef<string[]>([]); chRef.current = channels.map((c) => c.id);
  useEffect(() => { setUnread(unreads); }, [JSON.stringify(unreads)]); // eslint-disable-line
  useEffect(() => { if (params.channelId) setUnread((u) => ({ ...u, [params.channelId!]: 0 })); }, [params.channelId]);
  useEffect(() => {
    const c = sb.channel(`unread:${server.id}:${meId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "channel_messages" }, (p: any) => {
      const m = p.new; if (m.author_id === meId || !chRef.current.includes(m.channel_id) || m.channel_id === params.channelId) return;
      setUnread((u) => ({ ...u, [m.channel_id]: Math.min(99, (u[m.channel_id] ?? 0) + 1) }));
    }).subscribe();
    return () => { sb.removeChannel(c); };
  }, [server.id, params.channelId]); // eslint-disable-line
  async function move(kind: "ch" | "cat", id: string, dir: -1 | 1) {
    const list = kind === "cat" ? [...categories].sort((a, b) => a.position - b.position)
      : channels.filter((x) => x.category_id === channels.find((y) => y.id === id)!.category_id).sort((a, b) => a.position - b.position);
    const i = list.findIndex((x) => x.id === id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]];
    const res = await Promise.all(next.map((x, k) => sb.from(kind === "cat" ? "categories" : "channels").update({ position: k }).eq("id", x.id)));
    res.some((r) => r.error) ? setMsg("Não foi possível reordenar.") : router.refresh();
  }
  async function uploadImg(file: File, kind: "icon" | "banner") {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!ok.includes(file.type)) return setMsg("Formato inválido (PNG, JPG, WebP ou GIF).");
    if (file.size > (kind === "icon" ? 5242880 : 8388608)) return setMsg("Arquivo muito grande.");
    const bucket = kind === "icon" ? "avatars" : "banners"; const path = `${meId}/srv-${server.id}-${Date.now()}.${file.type.split("/")[1]}`;
    const up = await sb.storage.from(bucket).upload(path, file, { contentType: file.type }); if (up.error) return setMsg("Falha no upload.");
    const url = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from("servers").update({ [kind === "icon" ? "icon_url" : "banner_url"]: url }).eq("id", server.id);
    error ? fail(error) : (setMsg("Imagem atualizada."), router.refresh());
  }
  useEffect(() => { sb.from("notification_mutes").select("target_id").eq("user_id", meId).eq("target_type", "server").eq("target_id", server.id).maybeSingle().then(({ data }) => setSrvMuted(!!data)); }, [server.id]); // eslint-disable-line
  async function toggleSrvMute() {
    const next = !srvMuted;
    const { error } = next ? await sb.from("notification_mutes").insert({ user_id: meId, target_type: "server", target_id: server.id })
      : await sb.from("notification_mutes").delete().eq("user_id", meId).eq("target_type", "server").eq("target_id", server.id);
    error ? fail(error) : setSrvMuted(next);
  }
  async function openReports() { setPanel("reports"); const { data } = await sb.rpc("list_reports", { p_server: server.id }); setReports(data ?? []); }
  async function setReport(id: string, st: string) { await sb.rpc("resolve_report", { rid: id, p_status: st }); openReports(); }
  async function reportServer() {
    const reason = prompt("Motivo da denúncia contra este servidor"); if (!reason?.trim()) return;
    const { error } = await sb.rpc("report_content", { p_type: "server", p_target: server.id, p_reason: reason.trim() });
    setMsg(error ? (error.code === "23505" ? "Você já denunciou este servidor." : "Não foi possível enviar a denúncia.") : "Denúncia enviada. Obrigado.");
  }
  async function openAccess(c: Ch) {
    setAccCh(c); setAccPriv(c.is_private); setPanel("access");
    const { data } = await sb.from("channel_role_access").select("role_id").eq("channel_id", c.id);
    setAccRoles((data ?? []).map((r: any) => r.role_id));
  }
  async function saveAccess() {
    const { error } = await sb.rpc("set_channel_access", { cid: accCh!.id, p_private: accPriv, p_roles: accRoles });
    error ? fail(error) : (setPanel(null), router.refresh());
  }
  const shown = (id: string) => pm.get(id) ?? "offline";
  const onl = members.filter((m) => shown(m.id) !== "offline"); const off = members.filter((m) => shown(m.id) === "offline");
  const ChRow = (c: Ch) => (
    <div key={c.id} className="group flex items-center">
      <Link href={`/app/server/${server.id}/c/${c.id}`} onClick={() => setOpen(false)}
        className={`flex-1 truncate rounded px-2 py-1 text-sm hover:bg-white/5 ${params.channelId === c.id ? "bg-white/10" : ""}`}>{icon[c.type]} {c.name}{c.is_private && " 🔒"}{(unread[c.id] ?? 0) > 0 && <span className="ml-2 rounded-full bg-red-500 px-1.5 text-[10px]">{unread[c.id]}</span>}</Link>
      {has("manage_channels") && <span className="hidden gap-1 text-xs group-hover:flex"><button onClick={() => move("ch", c.id, -1)} aria-label="Subir">▲</button><button onClick={() => move("ch", c.id, 1)} aria-label="Descer">▼</button><button onClick={() => openAccess(c)} aria-label="Acesso">🔒</button><button onClick={() => renameChannel(c)} aria-label="Renomear">✎</button><button onClick={() => delChannel(c)} aria-label="Excluir">🗑</button></span>}
    </div>);
  return (
    <nav className="shrink-0 border-b border-nx-line bg-nx-panel md:w-64 md:border-b-0 md:border-r md:overflow-y-auto">
      <button className="flex w-full items-center justify-between px-4 py-3 font-semibold md:cursor-default" onClick={() => setOpen(!open)}>
        <span className="flex min-w-0 items-center gap-2">{server.icon_url && <img src={server.icon_url} alt="" className="h-6 w-6 rounded-lg object-cover" />}<span className="truncate">{server.name}</span></span><span className="md:hidden">{open ? "▴" : "▾"}</span></button>
      <div className={`${open ? "block" : "hidden"} max-h-[70vh] space-y-3 overflow-y-auto px-2 pb-3 md:block md:max-h-none`}>
        {msg && <p role="status" className="px-2 text-xs text-amber-300">{msg}</p>}
        <div className="flex flex-wrap gap-2 px-2 text-xs">
          {has("create_invites") && <button onClick={openInvites} className="rounded border border-nx-line px-2 py-1">Convites</button>}
          {has("view_audit_log") && <button onClick={openAudit} className="rounded border border-nx-line px-2 py-1">Registro</button>}
          {has("manage_server") && <button onClick={() => setPanel("settings")} className="rounded border border-nx-line px-2 py-1">Configurar</button>}
          {has("manage_roles") && <button onClick={() => setPanel("roles")} className="rounded border border-nx-line px-2 py-1">Cargos</button>}
          {has("kick_members") && <button onClick={openReports} className="rounded border border-nx-line px-2 py-1">Denúncias</button>}
          <button onClick={toggleSrvMute} className="rounded border border-nx-line px-2 py-1">{srvMuted ? "🔕" : "🔔"}</button>
          {!isOwner && <button onClick={reportServer} className="rounded border border-nx-line px-2 py-1">Denunciar</button>}
          {!isOwner && <button onClick={leave} className="rounded border border-nx-line px-2 py-1">Sair</button>}
        </div>
        {panel === "reports" && <div className="space-y-2 rounded-lg border border-nx-line p-2 text-xs">
          {reports.length === 0 && <p>Nenhuma denúncia pendente.</p>}
          {reports.map((r) => <div key={r.id} className="space-y-1 border-b border-nx-line pb-2"><p>{r.target_type} · @{r.reporter}</p><p>{r.reason}</p>{r.evidence && <p className="text-zinc-400">“{r.evidence}”</p>}
            <div className="flex gap-2"><button onClick={() => setReport(r.id, "resolved")}>Resolver</button><button onClick={() => setReport(r.id, "dismissed")}>Descartar</button></div></div>)}
          <button onClick={() => setPanel(null)}>Fechar</button></div>}
        {panel === "roles" && <RolesPanel serverId={server.id} roles={roles} members={members} myTop={myTop} myPerms={perms} onClose={() => setPanel(null)} />}
        {panel === "access" && accCh && <div className="space-y-2 rounded-lg border border-nx-line p-2 text-xs">
          <p className="font-semibold">Acesso a #{accCh.name}</p>
          <label className="flex gap-2"><input type="checkbox" checked={accPriv} onChange={(e) => setAccPriv(e.target.checked)} /> Canal privado</label>
          {accPriv && <><p className="text-zinc-400">Cargos que podem ver (o proprietário sempre vê):</p>
            {roles.map((r) => <label key={r.id} className="flex gap-2"><input type="checkbox" checked={accRoles.includes(r.id)}
              onChange={(e) => setAccRoles(e.target.checked ? [...accRoles, r.id] : accRoles.filter((x) => x !== r.id))} /><span style={{ color: r.color ?? undefined }}>{r.name}</span></label>)}</>}
          <div className="flex gap-2"><button onClick={saveAccess} className="nx-btn !px-2 !py-1 text-xs">Salvar</button><button onClick={() => setPanel(null)}>Fechar</button></div></div>}
        {panel === "invites" && <div className="space-y-1 rounded-lg border border-nx-line p-2 text-xs">
          <button onClick={makeInvite} className="nx-btn !px-2 !py-1 text-xs">Novo convite (7 dias, 50 usos)</button>
          {invites.map((i) => <div key={i.code} className="flex justify-between gap-2"><button className="truncate text-violet-300" onClick={() => navigator.clipboard.writeText(`${location.origin}/app/join/${i.code}`)}>{i.code} (copiar)</button>
            <button onClick={() => revoke(i.code)}>Revogar</button></div>)}
          <button onClick={() => setPanel(null)}>Fechar</button></div>}
        {panel === "audit" && <div className="space-y-1 rounded-lg border border-nx-line p-2 text-xs">
          {audit.length === 0 && <p>Sem registros.</p>}
          {audit.map((a) => <p key={a.id}>{new Date(a.created_at).toLocaleString("pt-BR")} · {a.actor?.username} → {a.action}{a.target ? ` @${a.target.username}` : ""}</p>)}
          <button onClick={() => setPanel(null)}>Fechar</button></div>}
        {panel === "settings" && <form onSubmit={saveSettings} className="space-y-2 rounded-lg border border-nx-line p-2 text-xs">
          <input name="name" className="nx-input" defaultValue={server.name} maxLength={64} />
          <textarea name="description" className="nx-input" placeholder="Descrição" defaultValue={server.description ?? ""} maxLength={500} />
          <textarea name="rules" className="nx-input" placeholder="Regras do servidor" defaultValue={server.rules ?? ""} maxLength={2000} />
          <label className="block">Ícone <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImg(e.target.files[0], "icon")} /></label>
          <label className="block">Banner <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImg(e.target.files[0], "banner")} /></label>
          <label className="flex gap-2"><input type="checkbox" name="is_public" defaultChecked={server.is_public} /> Público</label>
          <div className="flex gap-2"><button className="nx-btn !px-2 !py-1 text-xs">Salvar</button><button type="button" onClick={() => setPanel(null)}>Fechar</button></div>
          {isOwner && <button type="button" onClick={delServer} className="text-red-400">Excluir servidor</button>}</form>}

        {categories.map((cat) => (
          <div key={cat.id}>
            <div className="group flex items-center justify-between px-2 text-xs uppercase tracking-wide text-zinc-500"><span>{cat.name}</span>
              {has("manage_channels") && <span className="hidden gap-2 group-hover:flex"><button onClick={() => move("cat", cat.id, -1)} aria-label="Subir categoria">▲</button><button onClick={() => move("cat", cat.id, 1)} aria-label="Descer categoria">▼</button><button onClick={() => newChannel(cat.id)} aria-label="Novo canal">＋</button><button onClick={() => delCategory(cat)} aria-label="Excluir categoria">🗑</button></span>}</div>
            {channels.filter((c) => c.category_id === cat.id).map(ChRow)}
          </div>))}
        {channels.some((c) => !c.category_id) && <div>{channels.filter((c) => !c.category_id).map(ChRow)}</div>}
        {has("manage_channels") && <div className="flex gap-3 px-2 text-xs text-violet-300"><button onClick={() => newChannel(null)}>＋ Canal</button><button onClick={newCategory}>＋ Categoria</button></div>}

        <div className="px-2 text-xs uppercase tracking-wide text-zinc-500">Online — {onl.length}</div>
        {onl.map((m) => <MemRow key={m.id} m={m} />)}
        <div className="px-2 text-xs uppercase tracking-wide text-zinc-500">Offline — {off.length}</div>
        {off.map((m) => <MemRow key={m.id} m={m} />)}
      </div>
    </nav>
  );
  function MemRow({ m }: { m: Mem }) {
    const can = m.id !== meId && m.id !== server.owner_id;
    return (
      <div className="group flex items-center gap-2 px-2 text-sm">
        <i className={`h-2 w-2 shrink-0 rounded-full ${dot[shown(m.id)] ?? "bg-zinc-600"}`} />
        <span className="flex-1 truncate" style={m.color ? { color: m.color } : undefined}>{m.display_name ?? m.username}</span>
        {can && <span className="hidden gap-1 text-xs group-hover:flex">
          {has("kick_members") && <button onClick={() => member("kick_member", m)} aria-label="Expulsar">👢</button>}
          {has("ban_members") && <button onClick={() => member("ban_member", m)} aria-label="Banir">🔨</button>}
          {isOwner && <button onClick={() => member("transfer_ownership", m)} aria-label="Transferir propriedade">👑</button>}</span>}
      </div>);
  }
}
