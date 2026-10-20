import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PresenceProvider } from "@/components/PresenceProvider";
import Sidebar, { type ConvItem, type ServerItem } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("profiles").select("username, display_name, avatar_url").eq("id", user.id).single();

  const { data: isAdmin } = await sb.rpc("am_platform_admin");
  const { data: st } = await sb.from("user_settings").select("presence_pref").eq("user_id", user.id).single();
  const { data: sv } = await sb.from("server_members").select("servers(id, name, icon_url)").eq("user_id", user.id);
  const servers: ServerItem[] = (sv ?? []).map((r: any) => r.servers).filter(Boolean);
  const { data: mem } = await sb.from("direct_conversation_members")
    .select("conversation_id, last_read_at, archived, direct_conversations(is_group, name)")
    .eq("user_id", user.id);
  const ids = (mem ?? []).map((m: any) => m.conversation_id);
  const { data: others } = ids.length
    ? await sb.from("direct_conversation_members").select("conversation_id, profiles(username, display_name, avatar_url)")
        .in("conversation_id", ids).neq("user_id", user.id)
    : { data: [] as any[] };

  const convs: ConvItem[] = await Promise.all((mem ?? []).map(async (m: any) => {
    const peers = (others ?? []).filter((o: any) => o.conversation_id === m.conversation_id).map((o: any) => o.profiles);
    const { count } = await sb.from("direct_messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", m.conversation_id).neq("author_id", user.id).is("deleted_at", null).gt("created_at", m.last_read_at);
    const title = m.direct_conversations?.name ?? peers.map((p: any) => p.display_name ?? p.username).join(", ");
    return { id: m.conversation_id, title: title || "Conversa", avatar: peers[0]?.avatar_url ?? null, unread: count ?? 0, archived: !!m.archived };
  }));

  return (
    <PresenceProvider meId={user.id} initialPref={(st?.presence_pref ?? "online") as any}>
    <div className="flex h-dvh">
      <Sidebar me={{ ...me!, id: user.id }} convs={convs} servers={servers} isAdmin={Boolean(isAdmin)} />
      <main className="min-w-0 flex-1 overflow-y-auto pt-14 md:pt-0">{children}</main>
    </div>
    </PresenceProvider>
  );
}
