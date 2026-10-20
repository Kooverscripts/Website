import { NextResponse } from "next/server";

// Registro de erros do cliente (vai para os logs da hospedagem). Limite simples por IP, em memória.
const hits = new Map<string, { n: number; t: number }>();
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"; const now = Date.now();
  const h = hits.get(ip); if (!h || now - h.t > 60_000) hits.set(ip, { n: 1, t: now }); else if (++h.n > 10) return new NextResponse(null, { status: 429 });
  try {
    const b = await req.json();
    console.error(JSON.stringify({ level: "error", source: "client", message: String(b.message ?? "").slice(0, 500),
      digest: String(b.digest ?? "").slice(0, 100), path: String(b.path ?? "").slice(0, 200), at: new Date().toISOString() }));
  } catch {}
  return new NextResponse(null, { status: 204 });
}
