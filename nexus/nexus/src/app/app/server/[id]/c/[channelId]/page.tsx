import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getPerms } from "@/lib/perms";
import Chat from "@/components/Chat";
import VoiceRoom from "@/components/VoiceRoom";

export default async function ChannelPage({ params }: { params: { id: string; channelId: string } }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: ch } = await sb.from("channels").select("id, name, type, topic, server_id").eq("id", params.channelId).eq("server_id", params.id).single();
  if (!ch) notFound(); // RLS esconde canais privados sem acesso
  const p = await getPerms(sb, params.id, user!.id);
  const { data: mem } = await sb.from("server_members").select("profiles(id, username, display_name, avatar_url)").eq("server_id", params.id).limit(500);
  const members = (mem ?? []).map((m: any) => m.profiles);
  const has = (x: string) => p!.perms.includes(x);

  if (ch.type === "voice") {
    if (!has("connect_voice")) return <p className="p-6 text-sm text-zinc-400">Você não tem permissão para entrar em canais de voz.</p>;
    const { data: srv } = await sb.from("servers").select("max_voice_users").eq("id", params.id).single();
    const cap = Math.min(srv?.max_voice_users ?? 25, Number(process.env.NEXT_PUBLIC_VOICE_MESH_LIMIT ?? 8));
    return <VoiceRoom key={ch.id} roomId={`voice:${ch.id}`} channelId={ch.id} meId={user!.id} members={members} maxUsers={cap}
      title={`🔊 ${ch.name}`} canMute={has("mute_members")} canMove={has("move_members")} />;
  }
  const canSend = has("send_messages") && (ch.type === "text" || has("manage_channels"));
  return <Chat key={ch.id} conversationId={ch.id} meId={user!.id} members={members} title={`# ${ch.name}`}
    table="channel_messages" canSend={canSend} canModerate={has("delete_messages")} canAttach={has("attach_files")} canPin={has("manage_pins")} />;
}
