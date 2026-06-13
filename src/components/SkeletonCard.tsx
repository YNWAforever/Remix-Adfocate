export function SkeletonCard({ className = "" }: { className?: string }) {
  return <div className={`skeleton-acid skeleton-card ${className}`} aria-hidden />;
}
