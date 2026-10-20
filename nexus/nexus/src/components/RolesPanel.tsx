"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export type RoleT = { id: string; name: string; color: string | null; position: number; is_default: boolean; perms: string[] };
const LABEL: Record<string, string> = {
  manage_server: "Gerenciar servidor", manage_channels: "Gerenciar canais", manage_roles: "Gerenciar cargos",
  send_messages: "Enviar mensagens", attach_files: "Anexar arquivos", delete_messages: "Excluir mensagens",
  mention_everyone: "Mencionar todos", create_invites: "Criar convites", kick_members: "Expulsar", ban_members: "Banir",
  manage_pins: "Fixar mensagens", connect_voice: "Entrar em voz", mute_members: "Silenciar", move_members: "Mover", view_audit_log: "Ver registro" };

export default function RolesPanel({ serverId, roles, members, myTop, myPerms, onClose }: {
  serverId: string; roles: RoleT[]; members: { id: string; username: string; roleIds?: string[] }[]; myTop: number; myPerms: string[]; onClose: () => void }) {
  const sb = supabaseBrowser(); const router = useRouter();
  const [sel, setSel] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [who, setWho] = useState("");
  const [f, setF] = useState({ name: "", color: "#9ca3af", position: 1, perms: [] as string[] });
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  const editable = (r: RoleT) => r.position < myTop && r.name !== "Owner";
  const err = (e: any) => setMsg(e?.message?.includes("hierarchy") ? "A hierarquia impede esta ação." : e?.message?.includes("forbidden") ? "Sem permissão (não é possível dar/retirar permissões que você não tem)." : e?.code === "23505" ? "Já existe um cargo com esse nome." : "Ação não concluída.");
  function pick(r: RoleT | null) {
    setMsg(null);
    if (!r) { setSel("new"); setF({ name: "", color: "#9ca3af", position: 1, perms: ["send_messages"] }); }
    else { setSel(r.id); setF({ name: r.name, color: r.color ?? "#9ca3af", position: r.position, perms: [...r.perms] }); }
  }
  async function save() {
    const { error } = sel === "new"
      ? await sb.rpc("create_role", { sid: serverId, p_name: f.name, p_color: f.color, p_perms: f.perms })
      : await sb.rpc("update_role", { rid: sel, p_name: f.name, p_color: f.color, p_perms: f.perms, p_pos: f.position });
    if (error) return err(error); setSel(null); router.refresh();
  }
  async function remove() {
    if (!confirm("Excluir este cargo?")) return;
    const { error } = await sb.rpc("delete_role", { rid: sel }); if (error) return err(error); setSel(null); router.refresh();
  }
  async function toggleRole(uid: string, rid: string, add: boolean) {
    const { error } = await sb.rpc("assign_role", { sid: serverId, uid, rid, p_add: add }); error ? err(error) : router.refresh();
  }
  const m = members.find((x) => x.id === who);
  return (
    <div className="space-y-2 rounded-lg border border-nx-line p-2 text-xs">
      {msg && <p role="alert" className="text-amber-300">{msg}</p>}
      <p className="font-semibold">Cargos</p>
      {sorted.map((r) => <button key={r.id} className="block w-full truncate text-left" style={{ color: r.color ?? undefined }}
        onClick={() => editable(r) ? pick(r) : setMsg("Você não pode editar este cargo.")}>{r.name} <span className="text-zinc-500">({r.position})</span></button>)}
      <button onClick={() => pick(null)} className="text-violet-300">＋ Novo cargo</button>
      {sel && <div className="space-y-2 border-t border-nx-line pt-2">
        <input className="nx-input" value={f.name} maxLength={32} placeholder="Nome" onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="flex items-center gap-2"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
          {sel !== "new" && <label className="flex items-center gap-1">Posição <input type="number" min={0} max={Math.max(0, Math.min(myTop - 1, 99))} className="nx-input !w-16 !py-0" value={f.position} onChange={(e) => setF({ ...f, position: Number(e.target.value) })} /></label>}</div>
        {Object.keys(LABEL).map((p) => <label key={p} className="flex items-center gap-2">
          <input type="checkbox" disabled={!myPerms.includes(p)} checked={f.perms.includes(p)}
            onChange={(e) => setF({ ...f, perms: e.target.checked ? [...f.perms, p] : f.perms.filter((x) => x !== p) })} />{LABEL[p]}</label>)}
        <div className="flex gap-2"><button onClick={save} className="nx-btn !px-2 !py-1 text-xs">Salvar</button>
          {sel !== "new" && !roles.find((r) => r.id === sel)?.is_default && <button onClick={remove} className="text-red-400">Excluir</button>}
          <button onClick={() => setSel(null)}>Cancelar</button></div></div>}
      <div className="space-y-1 border-t border-nx-line pt-2"><p className="font-semibold">Atribuir cargos</p>
        <select className="nx-input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Escolha um membro…</option>
          {members.map((x) => <option key={x.id} value={x.id}>{x.username}</option>)}</select>
        {m && sorted.filter(editable).map((r) => <label key={r.id} className="flex items-center gap-2">
          <input type="checkbox" checked={m.roleIds?.includes(r.id) ?? false} onChange={(e) => toggleRole(m.id, r.id, e.target.checked)} />
          <span style={{ color: r.color ?? undefined }}>{r.name}</span></label>)}</div>
      <button onClick={onClose}>Fechar</button>
    </div>
  );
}
