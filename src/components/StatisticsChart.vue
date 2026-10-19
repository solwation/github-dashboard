<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import type { StatisticsDay, StatisticsMetric, StatisticsResolution } from "../lib/statistics";
import { formatBrowserDateTime } from "../lib/browser-time";
import { axisTickIndices, bucketTime, hasTime, valueTicks } from "../lib/statistics-chart";
const { t, locale } = useLanguage();
const props = defineProps<{
  series: { name: string; days: StatisticsDay[]; metric?: StatisticsMetric }[];
  metric: StatisticsMetric;
  title: string;
  resolution?: StatisticsResolution;
}>();
const selected = ref(0);
const chart = ref<SVGSVGElement | null>(null);
const chartWidth = ref(790);
const interaction = ref<"none" | "pointer" | "touch" | "keyboard">("none");
const showPopover = computed(() => interaction.value !== "none" && dates.value.length > 0);
const popoverLeft = computed(() => Math.max(8, Math.min(x(selected.value) + 12, chartWidth.value - 288)));
const plotStart = 48;
const plotTop = 30;
const plotBottom = 215;
const plotEnd = computed(() => Math.max(plotStart, chartWidth.value - 42));
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
const subDay = computed(() => props.resolution ? props.resolution !== "1d" : dates.value.some(hasTime));
// Theme tokens from style.css, so series stay legible in light and dark mode.
const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
function color(index: number) { return colors[index % colors.length]; }
function dash(index: number) { return index ? `${Math.max(2, 8 - (index % 5))} ${(index % 5) + 2}` : undefined; }
function valueOf(series: { metric?: StatisticsMetric }, day: StatisticsDay | undefined) {
  return day?.values[series.metric || props.metric] || 0;
}
const yTicks = computed(() => {
  const values = props.series.flatMap(series => series.days.map(day => valueOf(series, day)));
  return valueTicks(Math.min(0, ...values), Math.max(1, ...values));
});
const bounds = computed(() => ({ min: yTicks.value[0]!, max: yTicks.value[yTicks.value.length - 1]! }));
function x(index: number) { return plotStart + index / Math.max(1, dates.value.length - 1) * (plotEnd.value - plotStart); }
function y(value: number) { return plotBottom - (value - bounds.value.min) / Math.max(1e-9, bounds.value.max - bounds.value.min) * (plotBottom - plotTop); }
function points(series: { days: StatisticsDay[]; metric?: StatisticsMetric }) { return series.days.map((day, index) => `${x(index)},${y(valueOf(series, day))}`).join(" "); }
function number(value: number) { return value.toLocaleString(locale.value); }
const bucketStarts = computed(() => new Map((props.series[0]?.days || []).map(day => [day.date, day.start ?? bucketTime(day.date)])));
function pointTime(date: string) { return bucketStarts.value.get(date) ?? bucketTime(date); }
function shortDate(date: string) {
  const time = pointTime(date);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(locale.value, { day: "numeric", month: "short" }) : date;
}
function clock(date: string) {
  const time = pointTime(date);
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
}
function fullTime(date: string) {
  const time = pointTime(date);
  if (!Number.isFinite(time)) return date;
  const day = new Date(time).toLocaleDateString(locale.value, { day: "numeric", month: "short", year: "numeric" });
  return subDay.value && hasTime(date) ? `${day} ${new Date(time).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" })}` : day;
}
const xTicks = computed(() => {
  let previousDay = "";
  return axisTickIndices(dates.value.length, plotEnd.value - plotStart).map((index, position, all) => {
    const date = dates.value[index]!;
    const time = pointTime(date);
    const day = Number.isFinite(time) ? formatBrowserDateTime(time).slice(0, 10) : date;
    const timed = subDay.value && hasTime(date);
    const label = timed ? clock(date) : shortDate(date);
    const dateLine = timed && day !== previousDay ? shortDate(date) : "";
    previousDay = day;
    const anchor = all.length > 1 && position === 0 ? "start" : all.length > 1 && position === all.length - 1 ? "end" : "middle";
    return { index, label, dateLine, anchor };
  });
});
const selectedDate = computed(() => dates.value[selected.value] || "");
const selectedValues = computed(() => props.series.map((series, index) => ({ name: series.name, color: color(index), dash: dash(index), value: valueOf(series, series.days[selected.value]) })));
const selectedText = computed(() => `${fullTime(selectedDate.value)}: ${selectedValues.value.map(item => `${item.name}: ${number(item.value)}`).join(", ")}`);
function select(index: number) { selected.value = Math.max(0, Math.min(dates.value.length - 1, index)); }
function hidePointer() {
  if (interaction.value === "pointer") interaction.value = "none";
}
function selectFromPointer(event: PointerEvent | MouseEvent) {
  if (!chart.value || !dates.value.length) return;
  interaction.value = "pointerType" in event && event.pointerType === "touch" ? "touch" : "pointer";
  const rect = chart.value.getBoundingClientRect();
  if (!rect.width) return;
  const position = (event.clientX - rect.left) * chartWidth.value / rect.width;
  select(Math.round((position - plotStart) / Math.max(1, plotEnd.value - plotStart) * (dates.value.length - 1)));
}
</script>
<template>
  <div class="statistics-chart">
    <svg ref="chart" :viewBox="`0 0 ${chartWidth} 255`" role="img" :aria-label="title" @pointermove="selectFromPointer" @pointerdown="selectFromPointer" @pointerleave="hidePointer" @click="selectFromPointer">
      <title>{{ title }}</title>
      <g v-for="tick in yTicks" :key="tick">
        <line :class="tick === 0 ? 'chart-axis' : 'chart-grid'" :x1="plotStart" :y1="y(tick)" :x2="plotEnd" :y2="y(tick)" />
        <text :x="plotStart - 5" :y="y(tick) + 4" text-anchor="end">{{ number(tick) }}</text>
      </g>
      <text v-for="tick in xTicks" :key="tick.index" class="chart-x-label" :x="x(tick.index)" y="234" :text-anchor="tick.anchor">
        <tspan :x="x(tick.index)">{{ tick.label }}</tspan>
        <tspan v-if="tick.dateLine" :x="x(tick.index)" dy="14">{{ tick.dateLine }}</tspan>
      </text>
      <line v-if="showPopover" class="chart-cursor chart-axis" :x1="x(selected)" :y1="plotTop" :x2="x(selected)" :y2="plotBottom" stroke-dasharray="3 4" />
      <g v-for="(series, index) in series" :key="series.name">
        <polyline :points="points(series)" fill="none" :style="{ stroke: color(index) }" stroke-width="2" vector-effect="non-scaling-stroke" :stroke-dasharray="dash(index)" />
        <circle v-for="(day, dayIndex) in series.days" :key="day.date" :cx="x(dayIndex)" :cy="y(valueOf(series, day))" :r="showPopover && selected === dayIndex ? 5 : 3" :style="{ fill: color(index) }"><title>{{ series.name }} · {{ fullTime(day.date) }}: {{ number(valueOf(series, day)) }}</title></circle>
      </g>
    </svg>
    <div v-if="showPopover" class="chart-popover" role="tooltip" :style="{ left: `${popoverLeft}px` }">
      <strong class="chart-selection-time">{{ fullTime(selectedDate) }}</strong>
      <span v-for="item in selectedValues" :key="item.name" class="chart-selection-value"><svg class="chart-swatch" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" :style="{ stroke: item.color }" stroke-width="2.5" :stroke-dasharray="item.dash" /></svg><span>{{ item.name }}</span><b>{{ number(item.value) }}</b></span>
    </div>
    <div class="chart-legend"><span v-for="(series, index) in series" :key="series.name"><svg class="chart-swatch" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" :style="{ stroke: color(index) }" stroke-width="2.5" :stroke-dasharray="dash(index)" /><circle cx="11" cy="5" r="2.5" :style="{ fill: color(index) }" /></svg>{{ series.name }}</span></div>
    <label class="chart-day">{{ t("Tidpunkt i diagrammet") }}
      <input v-model.number="selected" type="range" min="0" :max="Math.max(0, dates.length - 1)" :aria-valuetext="selectedText" @focus="interaction = 'keyboard'" @input="interaction = 'keyboard'" @blur="interaction = 'none'" @keydown.esc="interaction = 'none'" />
    </label>
  </div>
</template>
<style scoped>
.statistics-chart { min-width: 0; position: relative; }
svg { width: 100%; height: 255px; display: block; overflow: hidden; touch-action: pan-y; }
svg line { vector-effect: non-scaling-stroke; }
svg text { fill: var(--chart-text); font: 11px system-ui; }
.chart-axis { stroke: var(--chart-axis); }
.chart-grid { stroke: var(--chart-grid); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 12px; margin: 10px 0; }
.chart-legend span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.chart-swatch { width: 22px; height: 10px; flex-shrink: 0; overflow: visible; }
.chart-day { display: grid; gap: 6px; font-size: 12px; margin-bottom: 14px; }
.chart-day input { width: 100%; accent-color: var(--green); }
.chart-popover { position: absolute; top: 12px; z-index: 2; width: min(280px, calc(100% - 16px)); box-sizing: border-box; display: grid; gap: 5px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 3px 12px #0002; font-size: 12px; overflow-wrap: anywhere; pointer-events: none; }
.chart-selection-time { font-size: 12px; margin-bottom: 2px; }
.chart-selection-value { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 6px; }
.chart-selection-value b { text-align: right; font-variant-numeric: tabular-nums; }
</style>
