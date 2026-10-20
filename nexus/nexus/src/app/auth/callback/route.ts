import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
// Destino do link de confirmação de e-mail / recuperação de senha
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";
  if (code) await supabaseServer().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/app", url.origin));
}
