"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Pref = "online" | "away" | "dnd" | "invisible";
const Ctx = createContext<{ map: Map<string, string>; pref: Pref; setPref: (p: Pref) => void }>({ map: new Map(), pref: "online", setPref: () => {} });
export const usePresence = () => useContext(Ctx);

// Presença baseada em conexões reais (Supabase Realtime Presence). Invisível = não anuncia nada.
export function PresenceProvider({ meId, initialPref, children }: { meId: string; initialPref: Pref; children: React.ReactNode }) {
  const sb = useRef(supabaseBrowser()).current;
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const [pref, setPrefState] = useState<Pref>(initialPref);
  const [idle, setIdle] = useState(false);
  const ch = useRef<any>(null); const ready = useRef(false);
  const status = pref === "online" && idle ? "away" : pref;
  const announce = useRef(() => {});
  announce.current = () => {
    if (!ready.current || !ch.current) return;
    status === "invisible" ? ch.current.untrack() : ch.current.track({ status });
  };

  useEffect(() => {
    const c = sb.channel("presence:global", { config: { presence: { key: meId } } });
    c.on("presence", { event: "sync" }, () => {
      const m = new Map<string, string>();
      Object.entries(c.presenceState()).forEach(([k, v]: any) => { const s = v[v.length - 1]?.status; if (s) m.set(k, s); });
      setMap(m);
    }).subscribe((s: string) => { ready.current = s === "SUBSCRIBED"; if (ready.current) announce.current(); });
    ch.current = c;
    sb.from("direct_conversation_members").update({ last_delivered_at: new Date().toISOString() }).eq("user_id", meId).then(() => {});
    return () => { ready.current = false; sb.removeChannel(c); };
  }, [meId]); // eslint-disable-line
  useEffect(() => { announce.current(); }, [status]);

  useEffect(() => {
    let t: any;
    const reset = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 5 * 60_000); };
    const evs = ["mousemove", "keydown", "touchstart", "click"];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true })); reset();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, []);

  const setPref = async (p: Pref) => { setPrefState(p); await sb.from("user_settings").update({ presence_pref: p }).eq("user_id", meId); };
  return <Ctx.Provider value={{ map, pref, setPref }}>{children}</Ctx.Provider>;
}
