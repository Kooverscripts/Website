"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase/client";

const schema = z.object({
  display_name: z.string().max(48), bio: z.string().max(500), pronouns: z.string().max(24),
  status_text: z.string().max(80), status_emoji: z.string().max(8),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  social_links: z.array(z.string().url().startsWith("https://")).max(3),
});
const OK_IMG = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function ProfileSettings() {
  const sb = supabaseBrowser();
  const [p, setP] = useState<any>(null); const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { (async () => {
    const { data: { user } } = await sb.auth.getUser();
    const { data } = await sb.from("profiles").select("*").eq("id", user!.id).single();
    setP(data);
  })(); }, []); // eslint-disable-line

  async function upload(file: File, bucket: "avatars" | "banners", max: number) {
    if (!OK_IMG.includes(file.type)) return setMsg("Formato inválido (use PNG, JPG, WebP ou GIF).");
    if (file.size > max) return setMsg(`Arquivo maior que ${max / 1048576} MB.`);
    const path = `${p.id}/${Date.now()}.${file.type.split("/")[1]}`;
    const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (error) return setMsg(error.message);
    const url = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const col = bucket === "avatars" ? "avatar_url" : "banner_url";
    const { error: e2 } = await sb.from("profiles").update({ [col]: url }).eq("id", p.id);
    e2 ? setMsg(e2.message) : setP({ ...p, [col]: url });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = schema.safeParse({ display_name: p.display_name ?? "", bio: p.bio ?? "", pronouns: p.pronouns ?? "",
      status_text: p.status_text ?? "", status_emoji: p.status_emoji ?? "", accent_color: p.accent_color,
      social_links: (Array.isArray(p.social_links) ? p.social_links : []).filter((x: string) => x && x.trim()).map((x: string) => x.trim()) });
    if (!r.success) return setMsg("Dados inválidos: " + r.error.issues[0].message);
    const { error } = await sb.from("profiles").update(r.data).eq("id", p.id);
    setMsg(error ? error.message : "Perfil salvo.");
  }
  if (!p) return <main className="p-6">Carregando…</main>;
  const set = (k: string) => (e: any) => setP({ ...p, [k]: e.target.value });
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <div className="flex justify-between text-sm"><a href="/app" className="text-violet-400">← Voltar</a><a href="/settings/account" className="text-violet-400">Conta e segurança</a></div>
      <h1 className="text-2xl font-bold">Perfil</h1>
      <div className="h-28 rounded-xl border border-nx-line bg-cover" style={{ backgroundColor: p.accent_color, backgroundImage: p.banner_url ? `url(${p.banner_url})` : undefined }} />
      <label className="block text-sm">Avatar <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "avatars", 5242880)} /></label>
      <label className="block text-sm">Banner <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "banners", 8388608)} /></label>
      <form onSubmit={save} className="space-y-3">
        <input className="nx-input" placeholder="Nome de exibição" value={p.display_name ?? ""} onChange={set("display_name")} />
        <textarea className="nx-input" placeholder="Bio" value={p.bio ?? ""} onChange={set("bio")} />
        <input className="nx-input" placeholder="Pronomes" value={p.pronouns ?? ""} onChange={set("pronouns")} />
        {[0, 1, 2].map((i) => <input key={i} className="nx-input" type="url" placeholder={`Link social ${i + 1} (https://…)`} value={Array.isArray(p.social_links) ? p.social_links[i] ?? "" : ""}
          onChange={(e) => { const a = Array.isArray(p.social_links) ? [...p.social_links] : []; a[i] = e.target.value; setP({ ...p, social_links: a }); }} />)}
        <div className="flex gap-2">
          <input className="nx-input w-16" placeholder="😀" value={p.status_emoji ?? ""} onChange={set("status_emoji")} />
          <input className="nx-input" placeholder="Status personalizado" value={p.status_text ?? ""} onChange={set("status_text")} />
        </div>
        <label className="flex items-center gap-2 text-sm">Cor <input type="color" value={p.accent_color} onChange={set("accent_color")} /></label>
        {msg && <p className="text-sm text-zinc-300">{msg}</p>}
        <button className="nx-btn">Salvar</button>
      </form>
    </main>
  );
}
