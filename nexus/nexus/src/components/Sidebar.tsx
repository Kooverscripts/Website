"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePresence } from "@/components/PresenceProvider";
import NotificationBell from "@/components/NotificationBell";

export type ConvItem = { id: string; title: string; avatar: string | null; unread: number; archived?: boolean };

export type ServerItem = { id: string; name: string; icon_url: string | null };

export default function Sidebar({ me, convs, servers, isAdmin }: { isAdmin: boolean; me: { id: string; username: string; display_name: string | null; avatar_url: string | null }; convs: ConvItem[]; servers: ServerItem[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const { pref, setPref } = usePresence();
  const link = (href: string) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${path === href ? "bg-white/10" : ""}`;
  return (
    <>
      <button aria-label="Abrir menu" onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-lg border border-nx-line bg-nx-panel px-3 py-2 md:hidden">☰</button>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-nx-line bg-nx-panel transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        onClick={() => setOpen(false)}>
        <div className="flex items-center justify-between p-4"><span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-xl font-bold text-transparent">NEXUS</span><NotificationBell meId={me.id} /></div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2">
          <Link href="/app" className={link("/app")}>👥 Amigos</Link>
          <Link href="/app/search" className={link("/app/search")}>🔎 Buscar</Link>
          <Link href="/app/discover" className={link("/app/discover")}>🧭 Descobrir / criar servidor</Link>
          {isAdmin && <Link href="/app/admin/reports" className={link("/app/admin/reports")}>🛡️ Denúncias</Link>}
          <p className="px-3 pt-4 text-xs uppercase tracking-wide text-zinc-500">Servidores</p>
          {servers.map((sv) => (
            <Link key={sv.id} href={`/app/server/${sv.id}`} className={link(`/app/server/${sv.id}`)}>
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-xl bg-blue-700 text-xs">
                {sv.icon_url ? <img src={sv.icon_url} alt="" className="h-full w-full object-cover" /> : sv.name[0]?.toUpperCase()}
              </span><span className="truncate">{sv.name}</span>
            </Link>
          ))}
          <p className="px-3 pt-4 text-xs uppercase tracking-wide text-zinc-500">Mensagens diretas</p>
          {convs.filter((c) => !c.archived).length === 0 && <p className="px-3 text-sm text-zinc-500">Nenhuma conversa ainda.</p>}
          {convs.filter((c) => !c.archived).map((c) => (
            <Link key={c.id} href={`/app/dm/${c.id}`} className={link(`/app/dm/${c.id}`)}>
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-violet-700 text-xs">
                {c.avatar ? <img src={c.avatar} alt="" className="h-full w-full object-cover" /> : c.title[0]?.toUpperCase()}
              </span>
              <span className="flex-1 truncate">{c.title}</span>
              {c.unread > 0 && <span className="rounded-full bg-red-500 px-2 text-xs">{c.unread}</span>}
            </Link>
          ))}
          {convs.some((c) => c.archived) && <details className="px-1"><summary className="cursor-pointer px-2 py-2 text-xs uppercase tracking-wide text-zinc-500">Arquivadas ({convs.filter((c) => c.archived).length})</summary>
          {convs.filter((c) => c.archived).map((c) => (
            <Link key={c.id} href={`/app/dm/${c.id}`} className={link(`/app/dm/${c.id}`)}>
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-violet-700 text-xs">
                {c.avatar ? <img src={c.avatar} alt="" className="h-full w-full object-cover" /> : c.title[0]?.toUpperCase()}
              </span>
              <span className="flex-1 truncate">{c.title}</span>
              {c.unread > 0 && <span className="rounded-full bg-red-500 px-2 text-xs">{c.unread}</span>}
            </Link>
          ))}
          </details>}
        </nav>
        <div className="flex items-center gap-3 border-t border-nx-line p-3">
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-violet-700">
            {me.avatar_url ? <img src={me.avatar_url} alt="" className="h-full w-full object-cover" /> : me.username[0].toUpperCase()}
          </span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm">{me.display_name ?? me.username}</p><p className="truncate text-xs text-zinc-500">@{me.username}</p></div>
          <select aria-label="Status" value={pref} onClick={(e) => e.stopPropagation()} onChange={(e) => setPref(e.target.value as any)} className="rounded bg-nx-bg text-xs">
            <option value="online">🟢</option><option value="away">🌙</option><option value="dnd">🔴</option><option value="invisible">⚫</option></select>
          <Link href="/settings/profile" aria-label="Configurações">⚙️</Link>
        </div>
      </aside>
    </>
  );
}
