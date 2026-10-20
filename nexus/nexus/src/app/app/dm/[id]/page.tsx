import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import DMShell from "@/components/DMShell";

export default async function DM({ params, searchParams }: { params: { id: string }; searchParams: { call?: string } }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const [{ data: mem }, { data: conv }] = await Promise.all([
    sb.from("direct_conversation_members").select("user_id, archived, profiles(id, username, display_name, avatar_url)").eq("conversation_id", params.id),
    sb.from("direct_conversations").select("is_group, name").eq("id", params.id).single()]);
  const mine = mem?.find((m: any) => m.user_id === user!.id);
  if (!mem || !mine || !conv) notFound();
  const members = mem.map((m: any) => m.profiles);
  const peers = members.filter((p: any) => p.id !== user!.id);
  const title = conv.name ?? (peers.map((p: any) => p.display_name ?? p.username).join(", ") || "Conversa");
  return <DMShell key={params.id} conversationId={params.id} meId={user!.id} members={members} title={title}
    startOpen={searchParams.call === "1"} isGroup={!!conv.is_group} archived={!!(mine as any).archived} />;
}
