type TablePageSkeletonProps = {
  rows?: number;
};

export function TablePageSkeleton({ rows = 8 }: TablePageSkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading table"
      className="min-h-full bg-[#f7f9fc] px-6 pb-6 pt-5"
    >
      <div className="mx-auto max-w-[1760px] animate-pulse space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="h-9 w-64 rounded bg-[#e2e6ee]" />
          <div className="flex gap-2">
            <div className="h-9 w-24 rounded bg-[#eef1f6]" />
            <div className="h-9 w-28 rounded bg-[#eef1f6]" />
            <div className="h-9 w-32 rounded bg-[#dbe7f5]" />
          </div>
        </div>
        <div className="rounded border border-[#dfe1e6] bg-white shadow-sm">
          <div className="flex gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-3">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="h-4 flex-1 rounded bg-[#e2e6ee]" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="flex gap-3 border-b border-[#ebecf0] px-4 py-4 last:border-b-0"
            >
              {Array.from({ length: 7 }, (_, cellIndex) => (
                <div
                  key={cellIndex}
                  className={`h-4 rounded bg-[#f0f2f5] ${cellIndex === 0 ? "w-32" : "flex-1"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
