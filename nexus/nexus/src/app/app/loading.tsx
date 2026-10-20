export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Carregando">
      <div className="h-6 w-1/3 rounded bg-nx-panel" />
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg border border-nx-line bg-nx-panel" />)}
    </div>
  );
}
