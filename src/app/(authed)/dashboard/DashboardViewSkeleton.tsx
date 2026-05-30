export function DashboardViewSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard">
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <article
            key={index}
            className="min-h-32 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="mx-auto h-4 w-36 animate-pulse rounded bg-slate-200" />
            <div className="mx-auto mt-6 h-10 w-28 animate-pulse rounded bg-slate-200" />
            <div className="mx-auto mt-5 h-4 w-40 animate-pulse rounded bg-slate-200" />
          </article>
        ))}
      </section>

      <section>
        <div className="mb-3 h-7 w-[34rem] max-w-full animate-pulse rounded bg-slate-200" />
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-[360px] animate-pulse rounded-lg bg-slate-100" />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DashboardTableSkeleton />
        <DashboardTableSkeleton />
      </section>

      <section>
        <div className="mb-3 h-7 w-[28rem] max-w-full animate-pulse rounded bg-slate-200" />
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-8 gap-px border-b border-slate-200 bg-slate-200">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="bg-slate-50 px-4 py-5">
                <div className="h-4 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-8 gap-px border-b border-slate-100 bg-slate-100 last:border-b-0"
            >
              {Array.from({ length: 8 }).map((__, columnIndex) => (
                <div key={columnIndex} className="bg-white px-4 py-5">
                  <div className="h-4 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DashboardTableSkeleton() {
  return (
    <section>
      <div className="mb-3 h-7 w-80 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-5 gap-px border-b border-slate-200 bg-slate-200">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="bg-slate-50 px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="grid grid-cols-5 gap-px border-b border-slate-100 bg-slate-100 last:border-b-0"
          >
            {Array.from({ length: 5 }).map((__, columnIndex) => (
              <div key={columnIndex} className="bg-white px-4 py-4">
                <div className="h-4 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
