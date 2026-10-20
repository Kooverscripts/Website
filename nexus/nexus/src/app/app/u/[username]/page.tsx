import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import ProfileActions, { PresenceBadge } from "@/components/ProfileActions";

export default async function ProfilePage({ params }: { params: { username: string } }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser(); const me = user!.id;
  const { data: p } = await sb.from("profiles")
    .select("id, username, display_name, avatar_url, banner_url, bio, accent_color, pronouns, status_text, status_emoji, social_links, created_at")
    .eq("username", decodeURIComponent(params.username)).maybeSingle();
  if (!p) notFound();
  const self = p.id === me;
  const [{ data: mutual }, { data: fr }, { data: bl }] = self ? [{ data: null }, { data: null }, { data: null }] : await Promise.all([
    sb.rpc("mutual_info", { target: p.id }),
    sb.from("friendships").select("status, requester_id").or(`and(requester_id.eq.${me},addressee_id.eq.${p.id}),and(requester_id.eq.${p.id},addressee_id.eq.${me})`).maybeSingle(),
    sb.from("blocked_users").select("blocked_id").eq("blocker_id", me).eq("blocked_id", p.id).maybeSingle()]);
  const relation = !fr ? "none" : fr.status === "accepted" ? "friends" : fr.requester_id === me ? "outgoing" : "incoming";
  const links: string[] = (Array.isArray(p.social_links) ? p.social_links : []).filter((u: any) => typeof u === "string" && u.startsWith("https://"));
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <div className="h-32 rounded-xl border border-nx-line bg-cover bg-center" style={{ backgroundColor: p.accent_color, backgroundImage: p.banner_url ? `url(${p.banner_url})` : undefined }} />
      <div className="-mt-12 flex items-end gap-3 px-3">
        <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border-4 border-nx-bg bg-violet-700 text-2xl">
          {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" /> : p.username[0].toUpperCase()}</span>
        <div className="pb-1"><h1 className="text-xl font-bold">{p.display_name ?? p.username}</h1>
          <p className="text-sm text-zinc-400">@{p.username}{p.pronouns && ` · ${p.pronouns}`}</p></div>
      </div>
      <div className="space-y-1 px-1"><PresenceBadge userId={p.id} />
        {(p.status_text || p.status_emoji) && <p className="text-sm">{p.status_emoji} {p.status_text}</p>}
        {p.bio && <p className="whitespace-pre-wrap text-sm text-zinc-300">{p.bio}</p>}
        <p className="text-xs text-zinc-500">Conta criada em {new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
        {links.length > 0 && <ul className="space-y-1 pt-1 text-sm">{links.map((u) => <li key={u}><a className="text-violet-400 hover:underline" href={u} target="_blank" rel="noopener noreferrer nofollow">{u.replace("https://", "")}</a></li>)}</ul>}</div>
      {self ? <Link href="/settings/profile" className="nx-btn inline-block">Editar perfil</Link>
        : <ProfileActions meId={me} targetId={p.id} relation={relation as any} blocked={!!bl} />}
      {!self && mutual && (mutual.friends.length > 0 || mutual.servers.length > 0) && <div className="space-y-3 rounded-xl border border-nx-line bg-nx-panel p-3 text-sm">
        {mutual.friends.length > 0 && <div><p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Amigos em comum ({mutual.friends.length})</p>
          <ul className="flex flex-wrap gap-2">{mutual.friends.map((f: any) => <li key={f.id}><Link className="text-violet-400" href={`/app/u/${f.username}`}>@{f.username}</Link></li>)}</ul></div>}
        {mutual.servers.length > 0 && <div><p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Servidores em comum ({mutual.servers.length})</p>
          <ul className="flex flex-wrap gap-2">{mutual.servers.map((s: any) => <li key={s.id}><Link className="text-violet-400" href={`/app/server/${s.id}`}>{s.name}</Link></li>)}</ul></div>}</div>}
    </div>
  );
}
