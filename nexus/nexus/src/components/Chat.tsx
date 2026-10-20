"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Member = { id: string; username: string; display_name: string | null; avatar_url: string | null };
type Msg = { pinned?: boolean; id: string; author_id: string; content: string | null; reply_to: string | null; edited_at: string | null; deleted_at: string | null; created_at: string };
const PAGE = 50;

export default function Chat({ conversationId, meId, members, title, table = "direct_messages", canSend = true, canModerate = false, canAttach = true, canPin = true }: { conversationId: string; meId: string; members: Member[]; title: string; table?: "direct_messages" | "channel_messages"; canSend?: boolean; canModerate?: boolean; canAttach?: boolean; canPin?: boolean }) {
  const fk = table === "direct_messages" ? "conversation_id" : "channel_id";
  const sb = supabaseBrowser();
  const [msgs, setMsgs] = useState<Map<string, Msg>>(new Map());
  const [text, setText] = useState(""); const [reply, setReply] = useState<Msg | null>(null);
  const [err, setErr] = useState<string | null>(null); const [typing, setTyping] = useState<string | null>(null);
  const [atts, setAtts] = useState<Map<string, any[]>>(new Map()); const [reacts, setReacts] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null); const [sending, setSending] = useState(false);
  const msgFk = table === "direct_messages" ? "direct_message_id" : "channel_message_id";
  const idsRef = useRef<string[]>([]);
  const [muted, setMuted] = useState(false); const [showPins, setShowPins] = useState(false); const [pins, setPins] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false); const [loading, setLoading] = useState(true);
  const bottom = useRef<HTMLDivElement>(null); const lastTyping = useRef(0);
  const typingCh = useRef<any>(null); const typingTimer = useRef<any>(null);
  const who = (id: string) => members.find((m) => m.id === id);

  const upsert = useCallback((list: Msg[]) => setMsgs((prev) => { const n = new Map(prev); list.forEach((m) => n.set(m.id, m)); return n; }), []);
  const markRead = useCallback(() => {
    if (table === "direct_messages") {
      sb.from("direct_conversation_members").update({ last_read_at: new Date().toISOString(), last_delivered_at: new Date().toISOString() })
        .eq("conversation_id", conversationId).eq("user_id", meId).then(() => {});
    } else {
      sb.from("read_receipts").upsert({ user_id: meId, channel_id: conversationId, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,channel_id,conversation_id" }).then(() => {});
    }
    sb.from("notifications").update({ read: true }).eq("user_id", meId).eq("read", false)
      .contains("payload", table === "direct_messages" ? { conversation_id: conversationId } : { channel_id: conversationId }).then(() => {});
  }, [conversationId, meId, table]); // eslint-disable-line

  useEffect(() => {
    let alive = true;
    setMsgs(new Map()); setLoading(true);
    sb.from(table).select("id, author_id, content, reply_to, edited_at, deleted_at, created_at, pinned")
      .eq(fk, conversationId).order("created_at", { ascending: false }).limit(PAGE)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setErr("Não foi possível carregar as mensagens.");
        upsert((data as Msg[]) ?? []); setHasMore((data?.length ?? 0) === PAGE); setLoading(false); markRead();
      });
    const ch = sb.channel(`dm:${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter: `${fk}=eq.${conversationId}` },
        (p: any) => { if (p.new?.id) { upsert([p.new as Msg]); if (p.eventType === "INSERT" && p.new.author_id !== meId) markRead(); } })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => fetchReacts())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_attachments" }, (p: any) => { const id = p.new?.[msgFk]; if (id && idsRef.current.includes(id)) fetchAtts([id]); })
      .subscribe();
    const tc = sb.channel(`typing:${conversationId}`)
      .on("broadcast", { event: "typing" }, ({ payload }: any) => {
        if (payload.id === meId) return;
        setTyping(who(payload.id)?.display_name ?? who(payload.id)?.username ?? "Alguém");
        clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(null), 3000);
      }).subscribe();
    typingCh.current = tc;
    return () => { alive = false; sb.removeChannel(ch); sb.removeChannel(tc); };
  }, [conversationId]); // eslint-disable-line

  async function fetchAtts(ids: string[]) {
    if (!ids.length) return;
    const { data } = await sb.from("message_attachments").select(`id, file_name, mime_type, size_bytes, storage_path, ${msgFk}`).in(msgFk, ids);
    const withUrl: any[] = [];
    for (const a of data ?? []) { const { data: u } = await sb.storage.from("attachments").createSignedUrl((a as any).storage_path, 3600); withUrl.push({ ...(a as any), url: u?.signedUrl }); }
    setAtts((prev) => { const n = new Map(prev); ids.forEach((i) => n.set(i, withUrl.filter((a) => a[msgFk] === i))); return n; });
  }
  async function fetchReacts() {
    const ids = idsRef.current; if (!ids.length) return;
    const { data } = await sb.from("message_reactions").select(`id, user_id, emoji, ${msgFk}`).in(msgFk, ids);
    setReacts((data as any[]) ?? []);
  }
  async function toggle(id: string, emoji: string) {
    const mine = reacts.find((r) => r[msgFk] === id && r.user_id === meId && r.emoji === emoji);
    const { error } = mine ? await sb.from("message_reactions").delete().eq("id", mine.id)
      : await sb.from("message_reactions").insert({ [msgFk]: id, user_id: meId, emoji });
    error ? setErr("Não foi possível reagir.") : fetchReacts();
  }
  const list = Array.from(msgs.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  useEffect(() => {
    const ids = list.map((m) => m.id).slice(-150); idsRef.current = ids;
    fetchReacts(); fetchAtts(ids.filter((i) => !atts.has(i)));
  }, [list.length]); // eslint-disable-line
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [list.length]);

  async function older() {
    const first = list[0]; if (!first) return;
    const { data } = await sb.from(table).select("id, author_id, content, reply_to, edited_at, deleted_at, created_at, pinned")
      .eq(fk, conversationId).lt("created_at", first.created_at).order("created_at", { ascending: false }).limit(PAGE);
    upsert((data as Msg[]) ?? []); setHasMore((data?.length ?? 0) === PAGE);
  }
  const OK = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "application/pdf", "text/plain", "application/zip"];
  function pickFile(f: File | null) {
    if (!f) return setFile(null);
    if (!OK.includes(f.type)) return setErr("Tipo de arquivo não permitido.");
    if (f.size > 26214400) return setErr("Arquivo maior que 25 MB.");
    setErr(null); setFile(f);
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (sending) return;
    const content = text.trim(); if (!content && !file) return;
    if (content.length > 4000) return setErr("Mensagem muito longa (máx. 4000).");
    setErr(null); setSending(true);
    let path: string | null = null;
    try {
      if (file) {
        path = `${meId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_").slice(-80)}`;
        const up = await sb.storage.from("attachments").upload(path, file, { contentType: file.type });
        if (up.error) { path = null; throw new Error("upload"); }
      }
      const { data, error } = await sb.from(table)
        .insert({ [fk]: conversationId, author_id: meId, content: content || null, reply_to: reply?.id ?? null })
        .select("id, author_id, content, reply_to, edited_at, deleted_at, created_at, pinned").single();
      if (error) throw error;
      if (file && path) {
        const { error: ae } = await sb.from("message_attachments").insert({ [msgFk]: (data as any).id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (ae) { await sb.storage.from("attachments").remove([path]); await sb.from(table).update({ deleted_at: new Date().toISOString(), content: null }).eq("id", (data as any).id); throw ae; }
      }
      upsert([data as Msg]); setText(""); setReply(null); setFile(null);
    } catch (e: any) {
      if (path) await sb.storage.from("attachments").remove([path]);
      setErr(e?.message?.includes("rate limit") ? "Você está enviando mensagens rápido demais." : e?.message === "upload" ? "Falha no upload do arquivo." : "Falha ao enviar. Sua mensagem foi mantida no campo.");
    } finally { setSending(false); }
  }
  function extras(m: Msg) {
    const al = atts.get(m.id) ?? []; const rs = reacts.filter((r) => r[msgFk] === m.id);
    const emojis = Array.from(new Set(rs.map((r) => r.emoji)));
    return (<>
      {al.map((a) => a.mime_type.startsWith("image/") && a.url ? <img key={a.id} src={a.url} alt={a.file_name} className="mt-2 max-h-64 rounded-lg" />
        : a.mime_type.startsWith("video/") && a.url ? <video key={a.id} src={a.url} controls className="mt-2 max-h-64 rounded-lg" />
        : <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-2 block rounded border border-nx-line px-2 py-1 text-xs text-violet-300">📄 {a.file_name} ({Math.ceil(a.size_bytes / 1024)} KB)</a>)}
      {emojis.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{emojis.map((e) => { const c = rs.filter((r) => r.emoji === e); const mine = c.some((r) => r.user_id === meId);
        return <button key={e} onClick={() => toggle(m.id, e)} className={`rounded-full border px-2 text-xs ${mine ? "border-violet-400 bg-violet-500/20" : "border-nx-line"}`}>{e} {c.length}</button>; })}</div>}
    </>);
  }
  function onType(v: string) {
    setText(v);
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      typingCh.current?.send({ type: "broadcast", event: "typing", payload: { id: meId } });
    }
  }
  useEffect(() => {
    if (table === "direct_messages") sb.from("direct_conversation_members").select("muted").eq("conversation_id", conversationId).eq("user_id", meId).single().then(({ data }) => setMuted(!!data?.muted));
    else sb.from("notification_mutes").select("target_id").eq("user_id", meId).eq("target_type", "channel").eq("target_id", conversationId).maybeSingle().then(({ data }) => setMuted(!!data));
  }, [conversationId]); // eslint-disable-line
  async function toggleMute() {
    const next = !muted;
    const { error } = table === "direct_messages"
      ? await sb.from("direct_conversation_members").update({ muted: next }).eq("conversation_id", conversationId).eq("user_id", meId)
      : next ? await sb.from("notification_mutes").insert({ user_id: meId, target_type: "channel", target_id: conversationId })
             : await sb.from("notification_mutes").delete().eq("user_id", meId).eq("target_type", "channel").eq("target_id", conversationId);
    error ? setErr("Não foi possível alterar o silenciamento.") : setMuted(next);
  }
  async function loadPins() {
    const { data } = await sb.from(table).select("id, author_id, content, reply_to, edited_at, deleted_at, created_at, pinned")
      .eq(fk, conversationId).eq("pinned", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
    setPins((data as Msg[]) ?? []);
  }
  async function pin(m: Msg) {
    const { error } = await sb.rpc("pin_message", { p_table: table, p_id: m.id, p_pinned: !m.pinned });
    if (error) return setErr("Você não tem permissão para fixar mensagens aqui.");
    if (showPins) setTimeout(loadPins, 300);
  }
  async function report(m: Msg) {
    const reason = prompt("Motivo da denúncia"); if (!reason?.trim()) return;
    const { error } = await sb.rpc("report_content", { p_type: "message", p_target: m.id, p_reason: reason.trim() });
    setErr(error ? (error.code === "23505" ? "Você já denunciou esta mensagem." : "Não foi possível enviar a denúncia.") : "Denúncia enviada. Obrigado.");
  }
  async function edit(m: Msg) {
    const v = prompt("Editar mensagem", m.content ?? ""); if (v == null || !v.trim() || v === m.content) return;
    const { error } = await sb.from(table).update({ content: v.trim(), edited_at: new Date().toISOString() }).eq("id", m.id);
    if (error) setErr("Não foi possível editar.");
  }
  async function del(m: Msg) {
    if (!confirm("Excluir esta mensagem?")) return;
    const { error } = await sb.from(table).update({ deleted_at: new Date().toISOString(), content: null }).eq("id", m.id);
    if (error) setErr("Não foi possível excluir.");
  }

  const [receipts, setReceipts] = useState<any[]>([]);
  useEffect(() => {
    if (table !== "direct_messages") return;
    const load = () => sb.from("direct_conversation_members").select("user_id, last_read_at, last_delivered_at").eq("conversation_id", conversationId).then(({ data }) => setReceipts((data as any[]) ?? []));
    load();
    const c = sb.channel(`rcpt:${conversationId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "direct_conversation_members", filter: `conversation_id=eq.${conversationId}` }, () => load()).subscribe();
    return () => { sb.removeChannel(c); };
  }, [conversationId]); // eslint-disable-line
  function tick(m: Msg) {
    const others = receipts.filter((r) => r.user_id !== meId); if (!others.length) return null;
    const t = Date.parse(m.created_at);
    const read = others.every((r) => Date.parse(r.last_read_at) >= t);
    const delivered = read || others.every((r) => Date.parse(r.last_delivered_at ?? "") >= t);
    return <span className={read ? "text-sky-400" : ""} aria-label={read ? "Lida" : delivered ? "Entregue" : "Enviada"}>{delivered ? " ✓✓" : " ✓"}</span>;
  }
  const mq = table === "channel_messages" ? /(?:^|\s)@([A-Za-z0-9_.]{0,32})$/.exec(text) : null;
  const sugg = mq ? members.filter((u) => u.id !== meId && u.username.toLowerCase().startsWith(mq[1].toLowerCase())).slice(0, 5) : [];
  function pickMention(u: string) { setText(text.replace(/@([A-Za-z0-9_.]{0,32})$/, `@${u} `)); }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-nx-line px-4 py-3 font-semibold"><span className="truncate">{title}</span>
        <span className="flex gap-3 text-base"><button aria-label="Mensagens fixadas" onClick={() => { setShowPins(!showPins); if (!showPins) loadPins(); }}>📌</button>
          <button aria-label={muted ? "Reativar notificações" : "Silenciar"} onClick={toggleMute}>{muted ? "🔕" : "🔔"}</button></span></header>
      {showPins && <div className="max-h-48 space-y-2 overflow-y-auto border-b border-nx-line bg-nx-panel p-3 text-sm">
        {pins.length === 0 && <p className="text-zinc-500">Nenhuma mensagem fixada.</p>}
        {pins.map((m) => <p key={m.id}><b>{who(m.author_id)?.username ?? "?"}:</b> {m.content}</p>)}</div>}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading && <p className="text-sm text-zinc-500">Carregando…</p>}
        {hasMore && <button onClick={older} className="mx-auto block text-sm text-violet-400">Carregar mensagens anteriores</button>}
        {!loading && list.length === 0 && <p className="text-center text-sm text-zinc-500">Nenhuma mensagem ainda. Diga olá!</p>}
        {list.map((m) => {
          const a = who(m.author_id); const mine = m.author_id === meId; const parent = m.reply_to ? msgs.get(m.reply_to) : null;
          return (
            <div key={m.id} className={`group flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-700 text-xs">
                {a?.avatar_url ? <img src={a.avatar_url} alt="" className="h-full w-full object-cover" /> : (a?.username[0] ?? "?").toUpperCase()}
              </span>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? "bg-violet-600/40" : "bg-nx-panel border border-nx-line"}`}>
                {parent && <p className="mb-1 border-l-2 border-violet-400 pl-2 text-xs text-zinc-400">{parent.deleted_at ? "Mensagem excluída" : parent.content?.slice(0, 80)}</p>}
                {m.deleted_at ? <p className="text-sm italic text-zinc-500">Mensagem excluída</p>
                  : <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>}
                {!m.deleted_at && extras(m)}
                <p className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                  {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{m.edited_at && !m.deleted_at && " · editada"}{m.pinned && !m.deleted_at && " · 📌"}{mine && table === "direct_messages" && !m.deleted_at && tick(m)}
                  {!m.deleted_at && <span className="hidden gap-2 group-hover:flex focus-within:flex">
                    {["👍", "❤️", "😂", "🎉"].map((e) => <button key={e} onClick={() => toggle(m.id, e)}>{e}</button>)}<button onClick={() => setReply(m)}>Responder</button>
                    {canPin && <button onClick={() => pin(m)}>{m.pinned ? "Desafixar" : "Fixar"}</button>}{!mine && <button onClick={() => report(m)}>Denunciar</button>}{mine && <button onClick={() => edit(m)}>Editar</button>}{(mine || canModerate) && <button onClick={() => del(m)}>Excluir</button>}
                  </span>}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="h-5 px-4 text-xs text-zinc-400">{typing && `${typing} está digitando…`}</div>
      {reply && <div className="mx-4 flex justify-between rounded-t-lg bg-nx-panel px-3 py-1 text-xs text-zinc-400">
        <span>Respondendo: {reply.content?.slice(0, 60)}</span><button onClick={() => setReply(null)}>✕</button></div>}
      {err && <p role="alert" className="px-4 text-sm text-red-400">{err}</p>}
      {!canSend ? <p className="p-4 text-center text-sm text-zinc-500">Você não tem permissão para enviar mensagens aqui.</p> :
      <form onSubmit={send} className="flex gap-2 p-4">
        {canAttach && <label className="grid cursor-pointer place-items-center px-2" aria-label="Anexar arquivo">📎
          <input type="file" hidden onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>}
        <div className="relative flex-1">
          {sugg.length > 0 && <ul role="listbox" className="absolute bottom-full mb-1 w-full overflow-hidden rounded-lg border border-nx-line bg-nx-panel shadow-xl">
            {sugg.map((u) => <li key={u.id}><button type="button" role="option" aria-selected="false" className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => pickMention(u.username)}>@{u.username} <span className="text-xs text-zinc-500">{u.display_name}</span></button></li>)}</ul>}
          <input className="nx-input" placeholder="Escreva uma mensagem…" value={text} onChange={(e) => onType(e.target.value)} maxLength={4000} />
        </div>
        {file && <button type="button" onClick={() => setFile(null)} className="max-w-[8rem] truncate self-center text-xs text-zinc-400">{file.name} ✕</button>}
        <button className="nx-btn" disabled={sending}>{sending ? "…" : "Enviar"}</button>
      </form>}
    </div>
  );
}
