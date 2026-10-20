"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Join() {
  const { code } = useParams<{ code: string }>(); const sb = supabaseBrowser(); const router = useRouter();
  const [info, setInfo] = useState<any>(null); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { sb.rpc("invite_preview", { p_code: code }).then(({ data }) => { setInfo(data?.[0] ?? null); setLoaded(true); }); }, [code]); // eslint-disable-line
  async function join() {
    const { data, error } = await sb.rpc("join_server_by_invite", { p_code: code });
    if (error) return setErr(error.message.includes("banned") ? "Você foi banido deste servidor." : "Convite inválido ou expirado.");
    router.push(`/app/server/${data}`); router.refresh();
  }
  if (!loaded) return <p className="p-6">Carregando…</p>;
  if (!info || !info.valid) return <p className="p-6">Convite inválido, expirado ou revogado.</p>;
  return (
    <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
      <p className="text-sm text-zinc-400">Você foi convidado para</p>
      <h1 className="text-2xl font-bold">{info.name}</h1>
      <p className="text-sm text-zinc-500">{info.member_count} membro(s)</p>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      <button className="nx-btn" onClick={join}>Aceitar convite</button>
    </div>
  );
}
