import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getPerms } from "@/lib/perms";
import ServerNav from "@/components/ServerNav";

export const dynamic = "force-dynamic";

export default async function ServerLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: server } = await sb.from("servers").select("id, name, description, is_public, owner_id, rules, icon_url, banner_url").eq("id", params.id).single();
  if (!server) notFound();
  const { data: mine } = await sb.from("server_members").select("user_id").eq("server_id", params.id).eq("user_id", user!.id).maybeSingle();
  if (!mine) redirect("/app/discover");
  const p = await getPerms(sb, params.id, user!.id);

  const [{ data: cats }, { data: chans }, { data: roles }, { data: mroles }, { data: mem }] = await Promise.all([
    sb.from("categories").select("id, name, position").eq("server_id", params.id).order("position"),
    sb.from("channels").select("id, name, type, category_id, position, is_private").eq("server_id", params.id).order("position"),
    sb.from("roles").select("id, name, color, position, is_default, role_permissions(permission)").eq("server_id", params.id),
    sb.from("member_roles").select("user_id, role_id").eq("server_id", params.id),
    sb.from("server_members").select("user_id, profiles(id, username, display_name, avatar_url, presence)").eq("server_id", params.id).limit(500),
  ]);
  const members = (mem ?? []).map((m: any) => {
    const rs = (mroles ?? []).filter((r: any) => r.user_id === m.user_id).map((r: any) => roles?.find((x: any) => x.id === r.role_id)).filter(Boolean) as any[];
    const top = rs.sort((a, b) => b.position - a.position)[0];
    return { ...m.profiles, role: top?.name ?? null, color: top?.color ?? null, roleIds: rs.map((r) => r.id) };
  });
  const { data: unr } = await sb.rpc("channel_unreads", { sid: params.id });
  const myTop = p!.isOwner ? 2147483647 : Math.max(-1, ...(mroles ?? []).filter((r: any) => r.user_id === user!.id).map((r: any) => roles?.find((x: any) => x.id === r.role_id)?.position ?? -1));
  return (
    <div className="flex h-full flex-col md:flex-row">
      <ServerNav server={server} meId={user!.id} isOwner={p!.isOwner} perms={p!.perms}
        categories={cats ?? []} channels={chans ?? []} members={members}
        roles={(roles ?? []).map((r: any) => ({ id: r.id, name: r.name, color: r.color, position: r.position, is_default: r.is_default, perms: r.role_permissions.map((x: any) => x.permission) }))} myTop={myTop} unreads={Object.fromEntries((unr ?? []).map((u: any) => [u.channel_id, u.unread]))} />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
