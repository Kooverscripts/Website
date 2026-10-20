"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePresence } from "@/components/PresenceProvider";

type N = { id: string; type: string; payload: any; read: boolean; created_at: string };
const text = (n: N) => {
  const p = n.payload;
  switch (n.type) {
    case "friend_request": return `@${p.author} enviou uma solicitação de amizade`;
    case "friend_accepted": return `@${p.author} aceitou sua solicitação`;
    case "call": return `📞 @${p.author} está chamando você${p.video ? " (vídeo)" : ""}`;
    case "dm": return `@${p.author}: ${p.preview}`;
    case "mention": return `@${p.author} mencionou você em #${p.channel} (${p.server}): ${p.preview}`;
    case "moderation": return `Você foi ${p.action === "ban" ? "banido" : p.action === "kick" ? "expulso" : "desbanido"} de ${p.server ?? "um servidor"}`;
    default: return "Nova notificação";
  }
};
const href = (n: N) => {
  const p = n.payload;
  if (n.type === "dm") return `/app/dm/${p.conversation_id}`;
  if (n.type === "call") return `/app/dm/${p.conversation_id}?call=1`;
  if (n.type === "mention") return `/app/server/${p.server_id}/c/${p.channel_id}`;
  if (n.type === "moderation") return "/app/discover";
  return "/app";
};

export default function NotificationBell({ meId }: { meId: string }) {
  const sb = supabaseBrowser(); const router = useRouter(); const path = usePathname(); const { pref } = usePresence();
  const [items, setItems] = useState<N[]>([]); const [open, setOpen] = useState(false); const [toast, setToast] = useState<N | null>(null);
  const unread = items.filter((i) => !i.read).length;

  async function load() {
    const { data } = await sb.from("notifications").select("id, type, payload, read, created_at").eq("user_id", meId).order("created_at", { ascending: false }).limit(30);
    setItems((data as N[]) ?? []);
  }
  useEffect(() => {
    load();
    const ch = sb.channel(`notif:${meId}`).on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${meId}` }, (p: any) => {
      load();
      if (p.eventType !== "INSERT") return;
      const n = p.new as N;
      if (n.type === "moderation") router.refresh();
      if (n.type === "dm" && n.payload?.conversation_id) sb.from("direct_conversation_members").update({ last_delivered_at: new Date().toISOString() }).eq("conversation_id", n.payload.conversation_id).eq("user_id", meId).then(() => {});
      if (n.type !== "call" && n.payload?.conversation_id && path.includes(n.payload.conversation_id)) return;
      if (n.payload?.channel_id && path.includes(n.payload.channel_id)) return;
      if (pref === "dnd") return;
      if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("NEXUS", { body: text(n) });
      else { setToast(n); setTimeout(() => setToast(null), 5000); }
    }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [meId, pref]); // eslint-disable-line

  async function readAll() { await sb.from("notifications").update({ read: true }).eq("user_id", meId).eq("read", false); load(); }
  async function go(n: N) { await sb.from("notifications").update({ read: true }).eq("id", n.id); setOpen(false); router.push(href(n)); load(); }
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Notificações" onClick={() => setOpen(!open)} className="relative rounded-lg px-2 py-1 hover:bg-white/10">🔔
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px]">{unread}</span>}</button>
      {open && <div className="absolute right-0 z-50 mt-2 max-h-96 w-72 overflow-y-auto rounded-xl border border-nx-line bg-nx-panel p-2 shadow-xl">
        <div className="mb-1 flex justify-between text-xs text-zinc-400"><button onClick={readAll}>Marcar todas como lidas</button>
          {"Notification" in window && Notification.permission === "default" && <button onClick={() => Notification.requestPermission()}>Ativar alertas</button>}</div>
        {items.length === 0 && <p className="p-2 text-sm text-zinc-500">Nada por aqui.</p>}
        {items.map((n) => <button key={n.id} onClick={() => go(n)} className={`block w-full rounded px-2 py-2 text-left text-sm hover:bg-white/5 ${n.read ? "text-zinc-500" : ""}`}>{text(n)}</button>)}
      </div>}
      {toast && <button onClick={() => go(toast)} className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl border border-violet-500 bg-nx-panel p-3 text-left text-sm shadow-xl">{text(toast)}</button>}
    </div>
  );
}
