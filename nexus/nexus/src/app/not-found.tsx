import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">Página não encontrada</h1>
      <p className="text-sm text-zinc-400">O conteúdo não existe ou você não tem acesso.</p>
      <Link href="/app" className="nx-btn">Voltar ao início</Link>
    </main>
  );
}
