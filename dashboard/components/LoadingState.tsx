export function SkeletonCard({ className = '' }: { className?: string }) {
  return <div className={`skeleton h-24 ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="flex gap-3">
      <div className="skeleton h-4 flex-1" />
      <div className="skeleton h-4 w-24" />
      <div className="skeleton h-4 w-16" />
    </div>
  );
}

export function KpiSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card p-6 border-rose-200 bg-rose-50 text-rose-800 text-sm">
      {message}
    </div>
  );
}
