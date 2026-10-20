"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import Chat from "@/components/Chat";
import VoiceRoom from "@/components/VoiceRoom";

type M = { id: string; username: string; display_name: string | null; avatar_url: string | null };
export default function DMShell({ conversationId, meId, members, title, startOpen, isGroup, archived }: {
  conversationId: string; meId: string; members: M[]; title: string; startOpen: boolean; isGroup: boolean; archived: boolean }) {
  const sb = supabaseBrowser(); const router = useRouter(); const [open, setOpen] = useState(startOpen); const [msg, setMsg] = useState<string | null>(null);
  async function call(video: boolean) { setOpen(true); await sb.rpc("start_call", { conv: conversationId, p_video: video }); }
  async function archive() {
    const { error } = await sb.from("direct_conversation_members").update({ archived: !archived }).eq("conversation_id", conversationId).eq("user_id", meId);
    if (error) return setMsg("Não foi possível alterar.");
    router.refresh(); if (!archived) router.push("/app");
  }
  async function leave() {
    if (!confirm("Sair deste grupo?")) return;
    const { error } = await sb.rpc("leave_conversation", { conv: conversationId });
    if (error) return setMsg("Não foi possível sair do grupo.");
    router.push("/app"); router.refresh();
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-nx-line px-4 py-2 text-sm">
        {msg && <span role="alert" className="mr-auto text-amber-300">{msg}</span>}
        <button onClick={() => call(false)}>📞 Ligar</button><button onClick={() => call(true)}>🎥 Vídeo</button>
        <button onClick={archive}>{archived ? "Desarquivar" : "Arquivar"}</button>
        {isGroup && <button onClick={leave} className="text-red-400">Sair do grupo</button>}</div>
      {open && <div className="max-h-[60vh] overflow-y-auto border-b border-nx-line">
        <VoiceRoom roomId={`call:${conversationId}`} meId={meId} members={members} maxUsers={Number(process.env.NEXT_PUBLIC_VOICE_MESH_LIMIT ?? 8)} title={`Chamada com ${title}`} />
        <button className="px-4 pb-3 text-xs text-zinc-400" onClick={() => setOpen(false)}>Fechar painel</button></div>}
      <Chat conversationId={conversationId} meId={meId} members={members} title={title} />
    </div>
  );
}
