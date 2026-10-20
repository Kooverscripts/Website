import "./globals.css";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "NEXUS" };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "dark", font = "normal", motion = "", accent: string | null = null;
  try {
    const sb = supabaseServer(); const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const [{ data: s }, { data: p }] = await Promise.all([
        sb.from("user_settings").select("theme, font_scale, reduce_motion").eq("user_id", user.id).single(),
        sb.from("profiles").select("accent_color").eq("id", user.id).single()]);
      theme = s?.theme ?? "dark"; font = s?.font_scale ?? "normal"; motion = s?.reduce_motion ? "reduce" : ""; accent = p?.accent_color ?? null;
    }
  } catch {}
  const style = theme === "custom" && accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? ({ "--nx-violet": rgb(accent) } as React.CSSProperties) : undefined;
  return <html lang="pt-BR" data-theme={theme === "light" ? "light" : "dark"} data-font={font} data-motion={motion} style={style}><body>{children}</body></html>;
}
