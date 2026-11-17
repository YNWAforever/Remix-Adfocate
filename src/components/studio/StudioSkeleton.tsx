/** Shape-only placeholder used while a home section has no data yet. */
export function StudioSkeleton({
  width = "60%",
  height = 16,
}: {
  width?: string;
  height?: number;
}) {
  return (
    <span
      className="s-skeleton"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
