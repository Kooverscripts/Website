"use client";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useVoiceRoom } from "@/lib/useVoiceRoom";

type M = { id: string; username: string; display_name: string | null; avatar_url: string | null };

function Media({ stream, kind, volume = 1, muted = false }: { stream: MediaStream; kind: "audio" | "video"; volume?: number; muted?: boolean }) {
  const ref = useRef<any>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume)); }, [volume]);
  return kind === "audio" ? <audio ref={ref} autoPlay />
    : <video ref={ref} autoPlay playsInline muted={muted} className="aspect-video w-full rounded-lg bg-black object-contain" />;
}

export default function VoiceRoom({ roomId, meId, members, maxUsers, channelId, title, canMute = false, canMove = false }: {
  roomId: string; meId: string; members: M[]; maxUsers: number; channelId?: string; title: string; canMute?: boolean; canMove?: boolean }) {
  const sb = supabaseBrowser(); const v = useVoiceRoom({ roomId, meId, maxUsers, commandChannelId: channelId });
  const who = (id: string) => members.find((m) => m.id === id);
  const name = (id: string) => who(id)?.display_name ?? who(id)?.username ?? "Usuário";
  const live = (s: MediaStream) => s.getVideoTracks().some((t) => t.readyState === "live");
  async function moderate(target: string, p_action: "mute" | "disconnect") { await sb.rpc("voice_moderate", { cid: channelId, target, p_action }); }
  const btn = "rounded-lg border border-nx-line px-3 py-2 text-sm hover:bg-white/10";

  if (v.status !== "joined") return (
    <div className="space-y-3 p-6"><h1 className="font-semibold">{title}</h1>
      <p className="text-sm text-zinc-400">Conexão direta entre participantes (até {maxUsers}). O navegador vai pedir acesso ao microfone.</p>
      {v.error && <p role="alert" className="text-sm text-red-400">{v.error}</p>}
      <button className="nx-btn" disabled={v.status === "connecting"} onClick={v.join}>{v.status === "connecting" ? "Conectando…" : "Entrar"}</button></div>);

  const videos = [
    ...(v.localScreen ? [{ key: "ls", label: "Sua tela", stream: v.localScreen, local: true }] : []),
    ...(v.localCam ? [{ key: "lc", label: "Você", stream: v.localCam, local: true }] : []),
    ...v.remote.flatMap((r) => r.streams.filter(live).map((s) => ({ key: `${r.id}-${s.id}`, label: name(r.id), stream: s, local: false }))),
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between"><h1 className="font-semibold">{title}</h1><span className="text-xs text-zinc-500">{v.participants.length}/{maxUsers}</span></div>
      {v.error && <p role="alert" className="text-sm text-amber-300">{v.error}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{v.participants.map((p) => (
        <li key={p.id} className={`space-y-2 rounded-xl border bg-nx-panel p-3 ${v.speaking.has(p.id) ? "border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.5)]" : "border-nx-line"}`}>
          <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-violet-700 text-xs">
            {who(p.id)?.avatar_url ? <img src={who(p.id)!.avatar_url!} alt="" className="h-full w-full object-cover" /> : name(p.id)[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{name(p.id)}{p.id === meId && " (você)"}</span>
            <span aria-label={p.muted ? "Microfone desligado" : "Microfone ligado"}>{p.muted ? "🔇" : "🎙️"}</span></div>
          {p.id !== meId && <label className="flex items-center gap-2 text-xs text-zinc-400">Volume
            <input type="range" min={0} max={1} step={0.05} value={v.volumes[p.id] ?? 1} onChange={(e) => v.setVolume(p.id, Number(e.target.value))} className="flex-1" /></label>}
          {p.id !== meId && channelId && (canMute || canMove) && <div className="flex gap-3 text-xs">
            {canMute && <button onClick={() => moderate(p.id, "mute")}>Silenciar</button>}
            {canMove && <button onClick={() => moderate(p.id, "disconnect")}>Desconectar</button>}</div>}
        </li>))}</ul>
      {videos.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{videos.map((x) => <figure key={x.key}><Media stream={x.stream} kind="video" muted /><figcaption className="text-xs text-zinc-400">{x.label}</figcaption></figure>)}</div>}
      {v.remote.flatMap((r) => r.streams.filter((s) => s.getAudioTracks().length > 0).map((s) => <Media key={`a-${s.id}`} stream={s} kind="audio" volume={v.volumes[r.id] ?? 1} />))}
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={v.toggleMute}>{v.muted ? "🔇 Ativar microfone" : "🎙️ Silenciar"}</button>
        <button className={btn} onClick={v.toggleCam}>{v.cam ? "📷 Desligar câmera" : "📷 Ligar câmera"}</button>
        <button className={btn} onClick={v.toggleScreen}>{v.screen ? "🖥️ Parar compartilhamento" : "🖥️ Compartilhar tela"}</button>
        <button className="rounded-lg bg-red-600 px-3 py-2 text-sm" onClick={v.leave}>Sair</button></div>
    </div>
  );
}
