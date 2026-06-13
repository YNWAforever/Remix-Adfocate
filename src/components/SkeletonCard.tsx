export function SkeletonCard({ className = "" }: { className?: string }) {
  return <div className={`skeleton-card ${className}`} aria-hidden />;
}
