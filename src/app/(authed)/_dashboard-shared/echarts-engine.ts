"use client";

type EchartsCore = typeof import("echarts/core");

let enginePromise: Promise<EchartsCore> | null = null;

// Chỉ tải phần ECharts đang dùng, và tải sau khi trang đã hiện số.
export function loadEchartsEngine() {
  enginePromise ??= Promise.all([
    import("echarts/core"),
    import("echarts/charts"),
    import("echarts/components"),
    import("echarts/renderers"),
  ])
    .then(([core, charts, components, renderers]) => {
      core.use([
        charts.BarChart,
        charts.LineChart,
        charts.LinesChart,
        charts.MapChart,
        charts.ScatterChart,
        components.GeoComponent,
        components.GridComponent,
        components.LegendComponent,
        components.TooltipComponent,
        renderers.CanvasRenderer,
      ]);

      return core;
    })
    .catch((error) => {
      // Tải lỗi thì lần mở sau được thử lại.
      enginePromise = null;
      throw error;
    });

  return enginePromise;
}
