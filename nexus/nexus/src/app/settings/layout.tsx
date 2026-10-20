import Link from "next/link";
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = "rounded-lg px-3 py-2 text-sm hover:bg-white/10";
  return (
    <div className="mx-auto max-w-lg">
      <nav aria-label="Configurações" className="flex flex-wrap items-center gap-1 border-b border-nx-line p-3">
        <Link href="/app" className={t}>← App</Link><Link href="/settings/profile" className={t}>Perfil</Link>
        <Link href="/settings/preferences" className={t}>Preferências</Link><Link href="/settings/account" className={t}>Conta</Link></nav>
      {children}
    </div>
  );
}
