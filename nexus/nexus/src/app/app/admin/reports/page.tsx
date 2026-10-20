"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function AdminReports() {
  const sb = supabaseBrowser(); const [rows, setRows] = useState<any[] | null>(null); const [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("list_reports", { p_server: null });
    if (error) return setDenied(true); setRows(data ?? []);
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  async function set(id: string, p_status: string) { await sb.rpc("resolve_report", { rid: id, p_status }); load(); }
  if (denied) return <p className="p-6 text-zinc-400">Acesso restrito a administradores da plataforma.</p>;
  if (!rows) return <p className="p-6">Carregando…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4"><h1 className="text-xl font-bold">Denúncias ({rows.length})</h1>
      {rows.length === 0 && <p className="text-sm text-zinc-500">Nenhuma denúncia pendente.</p>}
      {rows.map((r) => <div key={r.id} className="space-y-1 rounded-lg border border-nx-line bg-nx-panel p-3 text-sm">
        <p><b>{r.target_type}</b> · por @{r.reporter} · {new Date(r.created_at).toLocaleString("pt-BR")} · {r.status}</p>
        <p>Motivo: {r.reason}</p>{r.evidence && <p className="text-zinc-400">Evidência: “{r.evidence}”</p>}
        <p className="text-xs text-zinc-500">Alvo: {r.target_id}</p>
        <div className="flex gap-3 text-xs"><button onClick={() => set(r.id, "reviewing")}>Em análise</button><button onClick={() => set(r.id, "resolved")}>Resolver</button><button onClick={() => set(r.id, "dismissed")}>Descartar</button></div>
      </div>)}</div>
  );
}
