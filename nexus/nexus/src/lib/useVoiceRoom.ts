"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Participant = { id: string; muted: boolean; cam: boolean; screen: boolean };
type PeerSt = { pc: RTCPeerConnection; polite: boolean; making: boolean; ignore: boolean;
  senders: { cam?: RTCRtpSender; screen?: RTCRtpSender }; streams: Map<string, MediaStream> };
type Status = "idle" | "connecting" | "joined" | "error";

// Malha WebRTC (cada par se conecta direto) com "perfect negotiation".
// Sinalização: Supabase Realtime Broadcast em canal PRIVADO (autorizado por RLS em realtime.messages).
export function useVoiceRoom({ roomId, meId, maxUsers, commandChannelId }: { roomId: string; meId: string; maxUsers: number; commandChannelId?: string }) {
  const sb = useRef(supabaseBrowser()).current;
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState(false); const [cam, setCam] = useState(false); const [screen, setScreen] = useState(false);
  const [, setTick] = useState(0); const bump = () => setTick((n) => n + 1);

  const ch = useRef<any>(null); const peers = useRef(new Map<string, PeerSt>());
  const localMic = useRef<MediaStream | null>(null); const camStream = useRef<MediaStream | null>(null); const screenStream = useRef<MediaStream | null>(null);
  const ice = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  const my = useRef({ muted: false, cam: false, screen: false });
  const tracked = useRef(false); const maxRef = useRef(maxUsers); maxRef.current = maxUsers;
  const actx = useRef<AudioContext | null>(null); const analysers = useRef(new Map<string, { an: AnalyserNode; buf: Uint8Array }>());
  const timer = useRef<any>(null); const lastKey = useRef(""); const firstSync = useRef<any>(null);

  const announce = () => { if (tracked.current) ch.current?.track({ ...my.current }); };
  const send = (to: string, body: any) => ch.current?.send({ type: "broadcast", event: "signal", payload: { from: meId, to, ...body } });

  function watch(id: string, stream: MediaStream) {
    if (!actx.current || stream.getAudioTracks().length === 0 || analysers.current.has(id)) return;
    const an = actx.current.createAnalyser(); an.fftSize = 512;
    actx.current.createMediaStreamSource(stream).connect(an);
    analysers.current.set(id, { an, buf: new Uint8Array(an.fftSize) });
  }

  function makePeer(other: string): PeerSt {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    const st: PeerSt = { pc, polite: meId < other, making: false, ignore: false, senders: {}, streams: new Map() };
    peers.current.set(other, st);
    localMic.current?.getTracks().forEach((t) => pc.addTrack(t, localMic.current!));
    if (camStream.current) st.senders.cam = pc.addTrack(camStream.current.getVideoTracks()[0], camStream.current);
    if (screenStream.current) st.senders.screen = pc.addTrack(screenStream.current.getVideoTracks()[0], screenStream.current);
    pc.onicecandidate = ({ candidate }) => { if (candidate) send(other, { candidate: candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try { st.making = true; await pc.setLocalDescription(); send(other, { description: pc.localDescription!.toJSON() }); }
      catch (e) { console.error("negotiation", e); } finally { st.making = false; }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      st.streams.set(stream.id, stream);
      if (e.track.kind === "audio") watch(other, stream);
      stream.onremovetrack = () => { if (stream.getTracks().length === 0) st.streams.delete(stream.id); bump(); };
      e.track.onmute = bump; e.track.onunmute = bump; e.track.onended = bump; bump();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === "failed") pc.restartIce(); };
    return st;
  }
  function closePeer(id: string) { peers.current.get(id)?.pc.close(); peers.current.delete(id); analysers.current.delete(id); bump(); }

  async function handleSignal(from: string, msg: any) {
    if (!tracked.current) return;
    const st = peers.current.get(from) ?? makePeer(from); const pc = st.pc;
    try {
      if (msg.description) {
        const collision = msg.description.type === "offer" && (st.making || pc.signalingState !== "stable");
        st.ignore = !st.polite && collision; if (st.ignore) return;
        await pc.setRemoteDescription(msg.description);
        if (msg.description.type === "offer") { await pc.setLocalDescription(); send(from, { description: pc.localDescription!.toJSON() }); }
      } else if (msg.candidate) {
        try { await pc.addIceCandidate(msg.candidate); } catch (e) { if (!st.ignore) throw e; }
      }
    } catch (e) { console.error("signal", e); }
  }

  function syncPeers() {
    const state = ch.current?.presenceState() ?? {}; const list: Participant[] = []; const ids = new Set<string>();
    Object.entries(state).forEach(([k, v]: any) => {
      const m = v[v.length - 1] ?? {}; ids.add(k);
      list.push({ id: k, muted: !!m.muted, cam: !!m.cam, screen: !!m.screen });
      if (k !== meId && tracked.current && !peers.current.has(k)) makePeer(k);
    });
    peers.current.forEach((_, k) => { if (!ids.has(k)) closePeer(k); });
    setParticipants(list);
  }

  function tryTrack() {
    if (tracked.current || !ch.current) return;
    const others = Object.keys(ch.current.presenceState()).filter((k) => k !== meId).length;
    if (others >= maxRef.current - 1) { leave(); setError(`Sala cheia (máximo de ${maxRef.current} participantes).`); setStatus("error"); return; }
    tracked.current = true; ch.current.track({ ...my.current }); setStatus("joined"); syncPeers();
  }

  async function join() {
    if (status === "connecting" || status === "joined") return;
    setStatus("connecting"); setError(null);
    try {
      localMic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e: any) {
      setStatus("error");
      return setError(e?.name === "NotAllowedError" ? "Permissão de microfone negada. Libere o microfone nas configurações do navegador."
        : e?.name === "NotFoundError" ? "Nenhum microfone encontrado." : "Não foi possível acessar o microfone.");
    }
    try { const r = await fetch("/api/ice"); if (r.ok) { const j = await r.json(); if (j.iceServers) ice.current = j.iceServers; } } catch {}
    actx.current = new AudioContext(); watch(meId, localMic.current);
    timer.current = setInterval(() => {
      const s = new Set<string>();
      analysers.current.forEach(({ an, buf }, id) => {
        if (id === meId && my.current.muted) return;
        an.getByteTimeDomainData(buf); let sum = 0; for (const b of buf) { const x = (b - 128) / 128; sum += x * x; }
        if (Math.sqrt(sum / buf.length) > 0.04) s.add(id);
      });
      const key = Array.from(s).sort().join(","); if (key !== lastKey.current) { lastKey.current = key; setSpeaking(s); }
    }, 150);
    const c = sb.channel(roomId, { config: { private: true, broadcast: { self: false }, presence: { key: meId } } });
    ch.current = c;
    c.on("broadcast", { event: "signal" }, ({ payload }: any) => { if (payload?.to === meId) handleSignal(payload.from, payload); })
      .on("presence", { event: "sync" }, () => { if (!tracked.current) tryTrack(); else syncPeers(); })
      .subscribe((s: string) => {
        if (s === "SUBSCRIBED") { if (tracked.current) announce(); else firstSync.current = setTimeout(tryTrack, 1500); }
        else if ((s === "CHANNEL_ERROR" || s === "TIMED_OUT") && !tracked.current) {
          leave(); setStatus("error"); setError("Sem permissão para esta sala ou falha de conexão.");
        }
      });
  }

  function stopSource(kind: "cam" | "screen") {
    const ref = kind === "cam" ? camStream : screenStream;
    ref.current?.getTracks().forEach((t) => t.stop()); ref.current = null;
    peers.current.forEach((p) => { const s = p.senders[kind]; if (s) { try { p.pc.removeTrack(s); } catch {} delete p.senders[kind]; } });
    kind === "cam" ? setCam(false) : setScreen(false); my.current[kind] = false; announce(); bump();
  }
  function leave() {
    clearInterval(timer.current); clearTimeout(firstSync.current);
    if (tracked.current) { try { ch.current?.untrack(); } catch {} }
    if (ch.current) { sb.removeChannel(ch.current); ch.current = null; }
    peers.current.forEach((p) => p.pc.close()); peers.current.clear(); analysers.current.clear();
    [localMic, camStream, screenStream].forEach((r) => { r.current?.getTracks().forEach((t) => t.stop()); r.current = null; });
    actx.current?.close().catch(() => {}); actx.current = null; tracked.current = false;
    my.current = { muted: false, cam: false, screen: false };
    setMuted(false); setCam(false); setScreen(false); setParticipants([]); setSpeaking(new Set()); setStatus("idle");
  }
  function toggleMute() {
    const next = !my.current.muted; localMic.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    my.current.muted = next; setMuted(next); announce();
  }
  async function toggleCam() {
    if (my.current.cam) return stopSource("cam");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } }); const t = s.getVideoTracks()[0];
      camStream.current = s; t.onended = () => stopSource("cam");
      peers.current.forEach((p) => { p.senders.cam = p.pc.addTrack(t, s); });
      setCam(true); my.current.cam = true; announce(); bump();
    } catch (e: any) { setError(e?.name === "NotAllowedError" ? "Permissão de câmera negada." : "Não foi possível acessar a câmera."); }
  }
  async function toggleScreen() {
    if (my.current.screen) return stopSource("screen");
    try {
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 15 }, audio: false }); const t = s.getVideoTracks()[0];
      screenStream.current = s; t.onended = () => stopSource("screen");
      peers.current.forEach((p) => { p.senders.screen = p.pc.addTrack(t, s); });
      setScreen(true); my.current.screen = true; announce(); bump();
    } catch (e: any) { if (e?.name !== "NotAllowedError") setError("Não foi possível compartilhar a tela."); }
  }
  const forceMute = () => { localMic.current?.getAudioTracks().forEach((t) => (t.enabled = false)); my.current.muted = true; setMuted(true); announce(); };

  // comandos de moderação (validados no servidor pela RPC voice_moderate)
  useEffect(() => {
    if (status !== "joined" || !commandChannelId) return;
    const c = sb.channel(`vcmd:${meId}:${commandChannelId}`).on("postgres_changes",
      { event: "INSERT", schema: "public", table: "voice_commands", filter: `target_id=eq.${meId}` }, (p: any) => {
        const cmd = p.new; if (cmd.channel_id !== commandChannelId || Date.now() - new Date(cmd.created_at).getTime() > 30000) return;
        if (cmd.action === "mute") forceMute(); else { leave(); setError("Você foi desconectado por um moderador."); }
      }).subscribe();
    return () => { sb.removeChannel(c); };
  }, [status, commandChannelId]); // eslint-disable-line
  useEffect(() => () => { leave(); }, []); // eslint-disable-line

  return {
    status, error, participants, speaking, volumes, muted, cam, screen,
    setVolume: (id: string, v: number) => setVolumes((p) => ({ ...p, [id]: v })),
    join, leave, toggleMute, toggleCam, toggleScreen,
    localCam: camStream.current, localScreen: screenStream.current,
    remote: Array.from(peers.current.entries()).map(([id, p]) => ({ id, streams: Array.from(p.streams.values()) })),
  };
}
