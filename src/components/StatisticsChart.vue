<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import type { StatisticsDay, StatisticsMetric, StatisticsResolution } from "../lib/statistics";
import { formatBrowserDateTime, isAmbiguousBrowserTime } from "../lib/browser-time";
import { alignedValueTicks, axisTickIndices, bucketTime, hasTime, maxChartUnits, statisticsMetricUnit, type ChartUnit } from "../lib/statistics-chart";
const { t, locale } = useLanguage();
const props = defineProps<{
  /** `format` labels values (units, signs); a bucket without a value is a gap, never a zero (#280). */
  series: { name: string; days: StatisticsDay[]; metric?: StatisticsMetric; format?: (value: number) => string }[];
  metric: StatisticsMetric;
  title: string;
  resolution?: StatisticsResolution;
  coverage?: { from: number; to: number; percent: number; startPercent: number } | null;
}>();
const selected = ref(0);
const chart = ref<SVGSVGElement | null>(null);
const chartWidth = ref(790);
const interaction = ref<"none" | "pointer" | "touch" | "keyboard">("none");
const showPopover = computed(() => interaction.value !== "none" && dates.value.length > 0);
const popoverLeft = computed(() => Math.max(8, Math.min(x(selected.value) + 12, chartWidth.value - 288)));
// A second unit's axis needs room for its labels on the right; single-unit charts keep their layout.
const plotStart = computed(() => dual.value ? 54 : 48);
const plotTop = 30;
const viewportHeight = ref(typeof window === "undefined" ? 900 : window.innerHeight);
// Sparse periods need less vertical space; keep the SVG's coordinate and rendered heights
// identical so axes and labels retain their readable size at every density.
const baseHeight = computed(() => Math.max(144, Math.min(dates.value.length <= 7 ? 144 : dates.value.length <= 31 ? 184 : 224, Math.round(viewportHeight.value * .18))));
const chartHeight = computed(() => baseHeight.value + (props.coverage ? 22 : 0));
const plotBottom = computed(() => baseHeight.value - 40);
const plotEnd = computed(() => Math.max(plotStart.value, chartWidth.value - (dual.value ? 54 : 42)));
let resizeObserver: ResizeObserver | undefined;
function resizeChart() {
  viewportHeight.value = window.innerHeight;
  const width = chart.value?.getBoundingClientRect().width;
  if (width && Number.isFinite(width)) chartWidth.value = width;
}
onMounted(() => {
  resizeChart();
  if (typeof ResizeObserver !== "undefined" && chart.value) {
    resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(chart.value);
  }
  window.addEventListener("resize", resizeChart);
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
type Series = (typeof props.series)[number];
function valueOf(series: { metric?: StatisticsMetric }, day: StatisticsDay | undefined): number | null {
  const value = day?.values[series.metric || props.metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
// Units in series order: the first is the left axis, a second unit gets its own right axis (#283).
function unitOf(series: { metric?: StatisticsMetric }) { return statisticsMetricUnit(series.metric || props.metric); }
const units = computed(() => [...new Set(props.series.map(unitOf))].slice(0, maxChartUnits));
const dual = computed(() => units.value.length > 1);
function axisOf(series: { metric?: StatisticsMetric }) { return Math.max(0, Math.min(units.value.length - 1, units.value.indexOf(unitOf(series)))); }
const axes = computed(() => {
  const ranges = units.value.map((_, axis) => {
    const values = props.series.filter(series => axisOf(series) === axis).flatMap(series => series.days.map(day => valueOf(series, day)).filter((value): value is number => value !== null));
    return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
  });
  return alignedValueTicks(ranges.length ? ranges : [{ min: 0, max: 1 }]).map(({ ticks, labeled }) => ({ ticks, labeled, min: ticks[0]!, max: ticks[ticks.length - 1]! }));
});
const yTicks = computed(() => axes.value[0]!.ticks);
function x(index: number) { return plotStart.value + index / Math.max(1, dates.value.length - 1) * (plotEnd.value - plotStart.value); }
function y(value: number, axis = 0) {
  const bounds = axes.value[axis] || axes.value[0]!;
  return plotBottom.value - (value - bounds.min) / Math.max(1e-9, bounds.max - bounds.min) * (plotBottom.value - plotTop);
}
const unitTitles: Record<ChartUnit, string> = { count: "Antal", hours: "Timmar", percent: "Procent" };
/** Tick text; on a two-unit chart every tick carries its unit so each axis reads on its own. */
function tickText(tick: number, axis: number) {
  if (!dual.value) return number(tick);
  const unit = units.value[axis];
  if (unit === "hours") return t("{value} h", { value: number(tick) });
  if (unit === "percent") return (tick / 100).toLocaleString(locale.value, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 });
  return number(tick);
}
const axisLabels = computed(() => dual.value
  ? axes.value.flatMap((axis, index) => axis.ticks.map((tick, position) => ({ key: `${index}-${tick}`, tick, axis: index, show: axis.labeled[position] })).filter(item => item.show))
  : []);
/** Connected runs of defined values; missing estimate buckets break the line. */
function segments(series: { days: StatisticsDay[]; metric?: StatisticsMetric }) {
  const result: string[] = [];
  let current: string[] = [];
  series.days.forEach((day, index) => {
    const value = valueOf(series, day);
    if (value === null) { if (current.length) result.push(current.join(" ")); current = []; }
    else current.push(`${x(index)},${y(value, axisOf(series))}`);
  });
  if (current.length) result.push(current.join(" "));
  return result;
}
function number(value: number) { return value.toLocaleString(locale.value, { maximumFractionDigits: 2 }); }
function formatted(series: Series, value: number) { return series.format ? series.format(value) : number(value); }
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
  return subDay.value && hasTime(date) ? `${day} ${new Date(time).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(isAmbiguousBrowserTime(time) ? { timeZoneName: "shortOffset" as const } : {}) })}` : day;
}
const xTicks = computed(() => {
  let previousDay = "";
  return axisTickIndices(dates.value.length, plotEnd.value - plotStart.value).map((index, position, all) => {
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
const selectedValues = computed(() => props.series.flatMap((series, index) => {
  const value = valueOf(series, series.days[selected.value]);
  return value === null ? [] : [{ name: series.name, color: color(index), dash: dash(index), value, text: formatted(series, value) }];
}));
const selectedText = computed(() => `${fullTime(selectedDate.value)}: ${selectedValues.value.map(item => `${item.name}: ${item.text}`).join(", ")}`);
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
  select(Math.round((position - plotStart.value) / Math.max(1, plotEnd.value - plotStart.value) * (dates.value.length - 1)));
}
</script>
<template>
  <div class="statistics-chart">
    <svg ref="chart" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" :style="{ height: `${chartHeight}px` }" role="img" :aria-label="title" @pointermove="selectFromPointer" @pointerdown="selectFromPointer" @pointerleave="hidePointer" @click="selectFromPointer">
      <title>{{ title }}</title>
      <g v-for="tick in yTicks" :key="tick">
        <line :class="tick === 0 ? 'chart-axis' : 'chart-grid'" :x1="plotStart" :y1="y(tick)" :x2="plotEnd" :y2="y(tick)" />
        <text v-if="!dual" :x="plotStart - 5" :y="y(tick) + 4" text-anchor="end">{{ number(tick) }}</text>
      </g>
      <g v-if="dual" class="chart-y-axes">
        <text v-for="label in axisLabels" :key="label.key" :class="label.axis ? 'chart-y-label chart-y-right' : 'chart-y-label chart-y-left'" :x="label.axis ? plotEnd + 5 : plotStart - 5" :y="y(label.tick, label.axis) + 4" :text-anchor="label.axis ? 'start' : 'end'">{{ tickText(label.tick, label.axis) }}</text>
        <text class="chart-axis-title chart-axis-title-left" x="4" y="14" text-anchor="start">{{ t(unitTitles[units[0]!]) }}</text>
        <text class="chart-axis-title chart-axis-title-right" :x="chartWidth - 4" y="14" text-anchor="end">{{ t(unitTitles[units[1]!]) }}</text>
      </g>
      <text v-for="tick in xTicks" :key="tick.index" class="chart-x-label" :x="x(tick.index)" :y="plotBottom + 19" :text-anchor="tick.anchor">
        <tspan :x="x(tick.index)">{{ tick.label }}</tspan>
        <tspan v-if="tick.dateLine" :x="x(tick.index)" dy="14">{{ tick.dateLine }}</tspan>
      </text>
      <line v-if="showPopover" class="chart-cursor chart-axis" :x1="x(selected)" :y1="plotTop" :x2="x(selected)" :y2="plotBottom" stroke-dasharray="3 4" />
      <g v-for="(series, index) in series" :key="series.name">
        <polyline v-for="(line, lineIndex) in segments(series)" :key="lineIndex" :points="line" fill="none" :style="{ stroke: color(index) }" stroke-width="2" vector-effect="non-scaling-stroke" :stroke-dasharray="dash(index)" />
        <template v-for="(day, dayIndex) in series.days" :key="day.date">
          <circle v-if="valueOf(series, day) !== null" :cx="x(dayIndex)" :cy="y(valueOf(series, day)!, axisOf(series))" :r="showPopover && selected === dayIndex ? 5 : 3" :style="{ fill: color(index) }"><title>{{ series.name }} · {{ fullTime(day.date) }}: {{ formatted(series, valueOf(series, day)!) }}</title></circle>
        </template>
      </g>
      <g v-if="coverage" class="chart-coverage" role="img" :aria-label="coverage.percent > 0 ? t('Färdighämtat tidsspann: {from} – {to}', { from: new Date(coverage.from).toLocaleString(locale), to: new Date(coverage.to).toLocaleString(locale) }) : t('Tidsspannet är ännu inte bekräftat hämtat')">
        <line :x1="plotStart" :x2="plotEnd" :y1="baseHeight + 13" :y2="baseHeight + 13" class="chart-coverage-track" />
        <line :x1="plotStart + (plotEnd - plotStart) * coverage.startPercent / 100" :x2="plotStart + (plotEnd - plotStart) * (coverage.startPercent + coverage.percent) / 100" :y1="baseHeight + 13" :y2="baseHeight + 13" class="chart-coverage-loaded" />
      </g>
    </svg>
    <div v-if="showPopover" class="chart-popover" role="tooltip" :style="{ left: `${popoverLeft}px` }">
      <strong class="chart-selection-time">{{ fullTime(selectedDate) }}</strong>
      <span v-for="item in selectedValues" :key="item.name" class="chart-selection-value"><svg class="chart-swatch" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" :style="{ stroke: item.color }" stroke-width="2.5" :stroke-dasharray="item.dash" /></svg><span>{{ item.name }}</span><b>{{ item.text }}</b></span>
    </div>
    <div class="chart-legend"><span v-for="(series, index) in series" :key="series.name"><svg class="chart-swatch" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" :style="{ stroke: color(index) }" stroke-width="2.5" :stroke-dasharray="dash(index)" /><circle cx="11" cy="5" r="2.5" :style="{ fill: color(index) }" /></svg>{{ series.name }}<small v-if="dual" class="chart-legend-axis">· {{ axisOf(series) ? t("höger axel") : t("vänster axel") }}</small></span></div>
    <label class="chart-keyboard-control">{{ t("Tidpunkt i diagrammet") }}
      <input v-model.number="selected" type="range" min="0" :max="Math.max(0, dates.length - 1)" :aria-valuetext="selectedText" @focus="interaction = 'keyboard'" @input="interaction = 'keyboard'" @blur="interaction = 'none'" @keydown.esc="interaction = 'none'" />
    </label>
  </div>
</template>
<style scoped>
.chart-coverage-track { stroke: var(--line); stroke-width: 4; }
.chart-coverage-loaded { stroke: var(--green); stroke-width: 4; }
.statistics-chart { min-width: 0; position: relative; }
svg { width: 100%; height: 255px; display: block; overflow: hidden; touch-action: pan-y; }
svg line { vector-effect: non-scaling-stroke; }
svg text { fill: var(--chart-text); font: 11px system-ui; }
.chart-axis { stroke: var(--chart-axis); }
.chart-grid { stroke: var(--chart-grid); }
.chart-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: 12px; margin: var(--space-1) 0 0; }
.chart-legend span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.chart-axis-title { font-weight: 600; }
.chart-legend-axis { color: var(--muted); font-size: 11px; }
.chart-swatch { width: 22px; height: 10px; flex-shrink: 0; overflow: visible; }
/* Keep native slider semantics and keyboard navigation without a redundant visible row. */
.chart-keyboard-control { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.chart-keyboard-control:focus-within { left: 0; right: 0; bottom: 0; z-index: 3; display: grid; gap: 6px; width: auto; height: auto; padding: 8px 10px; border: 2px solid var(--green); border-radius: 6px; background: var(--surface); font-size: 12px; clip-path: none; white-space: normal; }
.chart-keyboard-control input { width: 100%; accent-color: var(--green); }
.chart-popover { position: absolute; top: 12px; z-index: 2; width: min(280px, calc(100% - 16px)); box-sizing: border-box; display: grid; gap: 5px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 3px 12px #0002; font-size: 12px; overflow-wrap: anywhere; pointer-events: none; }
.chart-selection-time { font-size: 12px; margin-bottom: 2px; }
.chart-selection-value { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 6px; }
.chart-selection-value b { text-align: right; font-variant-numeric: tabular-nums; }
</style>
