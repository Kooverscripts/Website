"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Account() {
  const sb = supabaseBrowser(); const [pw, setPw] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [confirmTxt, setConfirmTxt] = useState("");
  async function changePw(e: React.FormEvent) {
    e.preventDefault(); if (pw.length < 8) return setMsg("A senha precisa ter ao menos 8 caracteres.");
    const { error } = await sb.auth.updateUser({ password: pw }); setMsg(error ? error.message : "Senha alterada."); if (!error) setPw("");
  }
  async function others() { const { error } = await sb.auth.signOut({ scope: "others" }); setMsg(error ? "Não foi possível encerrar as outras sessões." : "Outras sessões encerradas."); }
  async function all() { await sb.auth.signOut({ scope: "global" }); window.location.href = "/login"; }
  async function exportData() {
    const { data: { user } } = await sb.auth.getUser(); const id = user!.id;
    const [p, s, f, dm, cm] = await Promise.all([
      sb.from("profiles").select("*").eq("id", id).single(), sb.from("user_settings").select("*").eq("user_id", id).single(),
      sb.from("friendships").select("*"), sb.from("direct_messages").select("*").eq("author_id", id).limit(5000),
      sb.from("channel_messages").select("*").eq("author_id", id).limit(5000)]);
    const blob = new Blob([JSON.stringify({ email: user!.email, profile: p.data, settings: s.data, friendships: f.data, direct_messages: dm.data, channel_messages: cm.data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "nexus-meus-dados.json"; a.click();
  }
  async function del() {
    if (confirmTxt !== "EXCLUIR") return setMsg('Digite EXCLUIR para confirmar.');
    const { error } = await sb.rpc("delete_my_account");
    if (error) return setMsg(error.message.includes("owns servers") ? "Transfira a propriedade ou exclua seus servidores antes de excluir a conta." : "Não foi possível excluir a conta.");
    await sb.auth.signOut(); window.location.href = "/login";
  }
  return (
    <main className="mx-auto max-w-lg space-y-8 p-6">
      <a href="/app" className="text-sm text-violet-400">← Voltar</a><h1 className="text-2xl font-bold">Conta e segurança</h1>
      {msg && <p role="status" className="text-sm text-amber-300">{msg}</p>}
      <form onSubmit={changePw} className="space-y-2"><h2 className="font-semibold">Alterar senha</h2>
        <input className="nx-input" type="password" placeholder="Nova senha (mín. 8)" value={pw} onChange={(e) => setPw(e.target.value)} /><button className="nx-btn">Salvar senha</button></form>
      <section className="space-y-2"><h2 className="font-semibold">Sessões</h2>
        <button onClick={others} className="mr-3 rounded-lg border border-nx-line px-3 py-2 text-sm">Encerrar outras sessões</button>
        <button onClick={all} className="rounded-lg border border-nx-line px-3 py-2 text-sm">Sair em todos os dispositivos</button></section>
      <section className="space-y-2"><h2 className="font-semibold">Meus dados</h2>
        <button onClick={exportData} className="rounded-lg border border-nx-line px-3 py-2 text-sm">Baixar meus dados (JSON)</button></section>
      <section className="space-y-2"><h2 className="font-semibold text-red-400">Excluir conta</h2>
        <p className="text-sm text-zinc-400">Remove perfil, amizades e mensagens. Não pode ser desfeito.</p>
        <input className="nx-input" placeholder='Digite EXCLUIR' value={confirmTxt} onChange={(e) => setConfirmTxt(e.target.value)} />
        <button onClick={del} className="rounded-lg bg-red-600 px-4 py-2">Excluir minha conta</button></section>
    </main>
  );
}
