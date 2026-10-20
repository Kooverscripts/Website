"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest, path: location.pathname }) }).catch(() => {});
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">Algo deu errado</h1>
      <p className="text-sm text-zinc-400">O erro foi registrado. Tente novamente.</p>
      <button className="nx-btn" onClick={reset}>Tentar de novo</button>
    </main>
  );
}
