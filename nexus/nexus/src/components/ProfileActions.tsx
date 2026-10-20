"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePresence } from "@/components/PresenceProvider";

const label: Record<string, string> = { online: "🟢 Online", away: "🌙 Ausente", dnd: "🔴 Não perturbe" };

export function PresenceBadge({ userId }: { userId: string }) {
  const st = usePresence().map.get(userId);
  return <span className="text-xs text-zinc-400">{label[st ?? ""] ?? "⚫ Offline"}</span>;
}

export default function ProfileActions({ meId, targetId, relation, blocked }: { meId: string; targetId: string; relation: "none" | "friends" | "outgoing" | "incoming"; blocked: boolean }) {
  const sb = supabaseBrowser(); const router = useRouter(); const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => { setMsg(m); router.refresh(); };
  async function dm() {
    const { data, error } = await sb.rpc("start_dm", { other: targetId });
    if (error) return setMsg(error.message.includes("blocked") ? "Você não pode enviar mensagem a este usuário." : error.message.includes("not allowed") ? "Este usuário não aceita mensagens suas." : "Não foi possível iniciar a conversa.");
    router.push(`/app/dm/${data}`); router.refresh();
  }
  async function add() {
    const { error } = await sb.from("friendships").insert({ requester_id: meId, addressee_id: targetId });
    done(error ? (error.code === "23505" ? "Já existe uma solicitação ou amizade." : error.message.includes("rate") ? "Muitas solicitações. Tente mais tarde." : "Este usuário não aceita solicitações suas.") : "Solicitação enviada.");
  }
  async function accept() { await sb.from("friendships").update({ status: "accepted" }).eq("requester_id", targetId).eq("addressee_id", meId); done("Amizade aceita."); }
  async function removeFriend() { await sb.from("friendships").delete().or(`and(requester_id.eq.${meId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${meId})`); done("Removido."); }
  async function block() { if (!confirm("Bloquear este usuário?")) return; const { error } = await sb.rpc("block_user", { target: targetId }); done(error ? "Não foi possível bloquear." : "Usuário bloqueado."); }
  async function unblock() { await sb.from("blocked_users").delete().eq("blocker_id", meId).eq("blocked_id", targetId); done("Desbloqueado."); }
  async function report() {
    const reason = prompt("Motivo da denúncia"); if (!reason?.trim()) return;
    const { error } = await sb.rpc("report_content", { p_type: "user", p_target: targetId, p_reason: reason.trim() });
    setMsg(error ? (error.code === "23505" ? "Você já denunciou este usuário." : "Não foi possível enviar a denúncia.") : "Denúncia enviada. Obrigado.");
  }
  const b = "rounded-lg border border-nx-line px-3 py-2 text-sm hover:bg-white/10";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!blocked && <button className="nx-btn !py-2 text-sm" onClick={dm}>Mensagem</button>}
        {!blocked && relation === "none" && <button className={b} onClick={add}>Adicionar amigo</button>}
        {relation === "outgoing" && <span className="px-3 py-2 text-sm text-zinc-400">Solicitação enviada</span>}
        {relation === "incoming" && <button className={b} onClick={accept}>Aceitar solicitação</button>}
        {relation === "friends" && <button className={b} onClick={removeFriend}>Remover amigo</button>}
        {blocked ? <button className={b} onClick={unblock}>Desbloquear</button> : <button className={b} onClick={block}>Bloquear</button>}
        <button className={b} onClick={report}>Denunciar</button>
      </div>
      {msg && <p role="status" className="text-sm text-zinc-300">{msg}</p>}
    </div>
  );
}
