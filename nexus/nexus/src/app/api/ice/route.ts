import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Entrega os servidores STUN/TURN só para usuários autenticados (credenciais TURN ficam no servidor).
export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const iceServers: any[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    iceServers.push({ urls: process.env.TURN_URL.split(","), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return NextResponse.json({ iceServers }, { headers: { "Cache-Control": "no-store" } });
}
