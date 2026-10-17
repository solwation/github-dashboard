<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import type { StatisticsDay, StatisticsMetric } from "../lib/statistics";
const { t, locale } = useLanguage();
const props = defineProps<{ series: { name: string; days: StatisticsDay[]; metric?: StatisticsMetric }[]; metric: StatisticsMetric; title: string }>();
const selected = ref(0);
const chart = ref<SVGSVGElement | null>(null);
const chartWidth = ref(790);
const plotEnd = computed(() => Math.max(48, chartWidth.value - 42));
let resizeObserver: ResizeObserver | undefined;
function resizeChart() {
  const width = chart.value?.getBoundingClientRect().width;
  if (width && Number.isFinite(width)) chartWidth.value = width;
}
onMounted(() => {
  resizeChart();
  if (typeof ResizeObserver !== "undefined" && chart.value) {
    resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(chart.value);
  } else window.addEventListener("resize", resizeChart);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", resizeChart);
});
const dates = computed(() => props.series[0]?.days.map(day => day.date) || []);
watch(dates, dates => { selected.value = Math.min(selected.value, Math.max(0, dates.length - 1)); });
// Theme tokens from style.css, so series stay legible in light and dark mode.
const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
function valueOf(series: { metric?: StatisticsMetric }, day: StatisticsDay | undefined) {
  return day?.values[series.metric || props.metric] || 0;
}
const bounds = computed(() => {
  const values = props.series.flatMap(series => series.days.map(day => valueOf(series, day)));
  return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
});
function x(index: number) { return 48 + index / Math.max(1, dates.value.length - 1) * (plotEnd.value - 48); }
function y(value: number) { return 215 - (value - bounds.value.min) / (bounds.value.max - bounds.value.min) * 185; }
function points(series: { days: StatisticsDay[]; metric?: StatisticsMetric }) { return series.days.map((day, index) => `${x(index)},${y(valueOf(series, day))}`).join(" "); }
function number(value: number) { return value.toLocaleString(locale.value); }
const selectedText = computed(() => `${dates.value[selected.value] || ""}: ${props.series.map(series => `${series.name}: ${number(valueOf(series, series.days[selected.value]))}`).join(", ")}`);
</script>
<template>
  <div class="statistics-chart">
    <svg ref="chart" :viewBox="`0 0 ${chartWidth} 255`" role="img" :aria-label="title">
      <title>{{ title }}</title>
      <line class="chart-axis" x1="48" :y1="y(0)" :x2="plotEnd" :y2="y(0)" />
      <line class="chart-grid" x1="48" y1="30" :x2="plotEnd" y2="30" />
      <text x="43" y="34" text-anchor="end">{{ number(bounds.max) }}</text>
      <text x="43" y="219" text-anchor="end">{{ number(bounds.min) }}</text>
      <text x="48" y="246">{{ dates[0] }}</text><text :x="plotEnd" y="246" text-anchor="end">{{ dates[dates.length - 1] }}</text>
      <line v-if="dates.length" :x1="x(selected)" y1="30" :x2="x(selected)" y2="215" class="chart-axis" stroke-dasharray="3 4" />
      <g v-for="(series, index) in series" :key="series.name">
        <polyline :points="points(series)" fill="none" :style="{ stroke: colors[index % colors.length] }" stroke-width="2" vector-effect="non-scaling-stroke" :stroke-dasharray="index ? `${Math.max(2, 8 - (index % 5))} ${(index % 5) + 2}` : undefined" />
        <circle v-for="(day, dayIndex) in series.days" :key="day.date" :cx="x(dayIndex)" :cy="y(valueOf(series, day))" :r="selected === dayIndex ? 5 : 3" :style="{ fill: colors[index % colors.length] }" @mouseenter="selected = dayIndex" @click="selected = dayIndex"><title>{{ series.name }} · {{ day.date }}: {{ valueOf(series, day) }}</title></circle>
      </g>
    </svg>
    <div class="chart-legend"><span v-for="(series, index) in series" :key="series.name"><i :style="{ background: colors[index % colors.length] }" />{{ series.name }}</span></div>
    <label class="chart-day">{{ t("Dag i diagrammet") }}
      <input v-model.number="selected" type="range" min="0" :max="Math.max(0, dates.length - 1)" :aria-valuetext="selectedText" />
    </label>
    <output class="chart-selection" aria-live="polite">{{ selectedText }}</output>
    <details class="daily-values"><summary>{{ t("Visa dagliga värden") }}</summary><div class="statistics-table-scroll"><table><caption>{{ title }}</caption><thead><tr><th scope="col">{{ t("Datum (UTC)") }}</th><th v-for="series in series" :key="series.name" scope="col">{{ series.name }}</th></tr></thead><tbody><tr v-for="(date, index) in dates" :key="date"><th scope="row">{{ date }}</th><td v-for="series in series" :key="series.name">{{ number(valueOf(series, series.days[index])) }}</td></tr></tbody></table></div></details>
  </div>
</template>
<style scoped>
.statistics-chart { min-width: 0; }
svg { width: 100%; height: 255px; display: block; overflow: hidden; }
svg line { vector-effect: non-scaling-stroke; }
svg text { fill: var(--chart-text); font: 11px system-ui; }
.chart-axis { stroke: var(--chart-axis); }
.chart-grid { stroke: var(--chart-grid); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 12px; margin: 10px 0; }
.chart-legend span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.chart-legend i { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.chart-day { display: grid; gap: 6px; font-size: 12px; }
.chart-day input { width: 100%; accent-color: var(--green); }
.chart-selection { display: block; font-size: 12px; margin: 8px 0 16px; overflow-wrap: anywhere; }
.daily-values summary { cursor: pointer; font-size: 13px; }
.statistics-table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
caption { text-align: left; margin: 8px 0; }
th, td { padding: 9px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
</style>
