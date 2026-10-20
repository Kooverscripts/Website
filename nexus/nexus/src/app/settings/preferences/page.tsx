"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type S = { theme: string; font_scale: string; reduce_motion: boolean; who_can_dm: string; who_can_friend: string; notify_dm: boolean; notify_mentions: boolean };

export default function Preferences() {
  const sb = supabaseBrowser(); const router = useRouter();
  const [s, setS] = useState<S | null>(null); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const { data: { user } } = await sb.auth.getUser();
    const { data } = await sb.from("user_settings").select("theme, font_scale, reduce_motion, who_can_dm, who_can_friend, notify_dm, notify_mentions").eq("user_id", user!.id).single();
    setS(data as S);
  })(); }, []); // eslint-disable-line
  async function save(e: React.FormEvent) {
    e.preventDefault(); const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("user_settings").update({ ...s, updated_at: new Date().toISOString() }).eq("user_id", user!.id);
    setMsg(error ? "Não foi possível salvar." : "Preferências salvas."); if (!error) router.refresh();
  }
  if (!s) return <main className="p-6">Carregando…</main>;
  const set = (k: keyof S) => (e: any) => setS({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const sel = "nx-input";
  return (
    <main className="space-y-6 p-6"><h1 className="text-2xl font-bold">Preferências</h1>
      <form onSubmit={save} className="space-y-6">
        <fieldset className="space-y-2"><legend className="font-semibold">Aparência</legend>
          <select className={sel} value={s.theme} onChange={set("theme")} aria-label="Tema">
            <option value="dark">Escuro</option><option value="light">Claro</option><option value="custom">Personalizado (usa a cor do seu perfil)</option></select></fieldset>
        <fieldset className="space-y-2"><legend className="font-semibold">Acessibilidade</legend>
          <select className={sel} value={s.font_scale} onChange={set("font_scale")} aria-label="Tamanho do texto">
            <option value="normal">Texto normal</option><option value="large">Texto grande</option><option value="xlarge">Texto muito grande</option></select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.reduce_motion} onChange={set("reduce_motion")} /> Reduzir animações</label></fieldset>
        <fieldset className="space-y-2"><legend className="font-semibold">Privacidade</legend>
          <label className="block text-sm">Quem pode me enviar mensagens diretas
            <select className={sel} value={s.who_can_dm} onChange={set("who_can_dm")}><option value="everyone">Todos</option><option value="friends">Somente amigos</option><option value="nobody">Ninguém</option></select></label>
          <label className="block text-sm">Quem pode me enviar solicitações de amizade
            <select className={sel} value={s.who_can_friend} onChange={set("who_can_friend")}><option value="everyone">Todos</option><option value="mutual">Quem tem amigo ou servidor em comum</option><option value="nobody">Ninguém</option></select></label></fieldset>
        <fieldset className="space-y-2"><legend className="font-semibold">Notificações</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.notify_dm} onChange={set("notify_dm")} /> Mensagens diretas</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.notify_mentions} onChange={set("notify_mentions")} /> Menções</label>
          <p className="text-xs text-zinc-500">Para silenciar um servidor, canal ou conversa específica, use o 🔔 dentro dele.</p></fieldset>
        {msg && <p role="status" className="text-sm text-zinc-300">{msg}</p>}
        <button className="nx-btn">Salvar</button>
      </form>
    </main>
  );
}
