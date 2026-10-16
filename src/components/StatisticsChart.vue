<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import type { StatisticsDay, StatisticsMetric } from "../lib/statistics";
const { t, locale } = useLanguage();
const props = defineProps<{ series: { name: string; days: StatisticsDay[] }[]; metric: StatisticsMetric; title: string }>();
const selected = ref(0);
const dates = computed(() => props.series[0]?.days.map(day => day.date) || []);
watch(dates, dates => { selected.value = Math.min(selected.value, Math.max(0, dates.length - 1)); });
const colors = ["#147d69", "#4b62b2", "#ae522b", "#8c4799", "#516c31"];
const bounds = computed(() => {
  const values = props.series.flatMap(series => series.days.map(day => day.values[props.metric] || 0));
  return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
});
function x(index: number) { return 48 + index / Math.max(1, dates.value.length - 1) * 700; }
function y(value: number) { return 215 - (value - bounds.value.min) / (bounds.value.max - bounds.value.min) * 185; }
function points(days: StatisticsDay[]) { return days.map((day, index) => `${x(index)},${y(day.values[props.metric] || 0)}`).join(" "); }
function number(value: number) { return value.toLocaleString(locale.value); }
const selectedText = computed(() => `${dates.value[selected.value] || ""}: ${props.series.map(series => `${series.name}: ${number(series.days[selected.value]?.values[props.metric] || 0)}`).join(", ")}`);
</script>
<template>
  <div class="statistics-chart">
    <svg viewBox="0 0 790 255" role="img" :aria-label="title">
      <title>{{ title }}</title>
      <line x1="48" :y1="y(0)" x2="748" :y2="y(0)" stroke="#aab6b7" />
      <line x1="48" y1="30" x2="748" y2="30" stroke="#e4e8eb" />
      <text x="43" y="34" text-anchor="end">{{ number(bounds.max) }}</text>
      <text x="43" y="219" text-anchor="end">{{ number(bounds.min) }}</text>
      <text x="48" y="246">{{ dates[0] }}</text><text x="748" y="246" text-anchor="end">{{ dates[dates.length - 1] }}</text>
      <line v-if="dates.length" :x1="x(selected)" y1="30" :x2="x(selected)" y2="215" stroke="#aab6b7" stroke-dasharray="3 4" />
      <g v-for="(series, index) in series" :key="series.name">
        <polyline :points="points(series.days)" fill="none" :stroke="colors[index % colors.length]" stroke-width="2" vector-effect="non-scaling-stroke" :stroke-dasharray="index ? `${8 - index} ${index + 2}` : undefined" />
        <circle v-for="(day, dayIndex) in series.days" :key="day.date" :cx="x(dayIndex)" :cy="y(day.values[metric] || 0)" :r="selected === dayIndex ? 5 : 3" :fill="colors[index % colors.length]" @mouseenter="selected = dayIndex" @click="selected = dayIndex"><title>{{ series.name }} · {{ day.date }}: {{ day.values[metric] || 0 }}</title></circle>
      </g>
    </svg>
    <div class="chart-legend"><span v-for="(series, index) in series" :key="series.name"><i :style="{ background: colors[index % colors.length] }" />{{ series.name }}</span></div>
    <label class="chart-day">{{ t("Dag i diagrammet") }}
      <input v-model.number="selected" type="range" min="0" :max="Math.max(0, dates.length - 1)" :aria-valuetext="selectedText" />
    </label>
    <output class="chart-selection" aria-live="polite">{{ selectedText }}</output>
    <details class="daily-values"><summary>{{ t("Visa dagliga värden") }}</summary><div class="statistics-table-scroll"><table><caption>{{ title }}</caption><thead><tr><th scope="col">{{ t("Datum (UTC)") }}</th><th v-for="series in series" :key="series.name" scope="col">{{ series.name }}</th></tr></thead><tbody><tr v-for="(date, index) in dates" :key="date"><th scope="row">{{ date }}</th><td v-for="series in series" :key="series.name">{{ number(series.days[index]?.values[metric] || 0) }}</td></tr></tbody></table></div></details>
  </div>
</template>
<style scoped>
.statistics-chart { min-width: 0; }
svg { width: 100%; max-width: 1000px; height: auto; display: block; margin-inline: auto; min-height: 130px; }
svg line { vector-effect: non-scaling-stroke; }
svg text { fill: #56696b; font: 11px system-ui; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 12px; margin: 10px 0; }
.chart-legend span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.chart-legend i { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.chart-day { display: grid; gap: 6px; font-size: 12px; }
.chart-day input { width: 100%; accent-color: #147d69; }
.chart-selection { display: block; font-size: 12px; margin: 8px 0 16px; overflow-wrap: anywhere; }
.daily-values summary { cursor: pointer; font-size: 13px; }
.statistics-table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
caption { text-align: left; margin: 8px 0; }
th, td { padding: 9px; text-align: left; border-bottom: 1px solid #e4e8eb; white-space: nowrap; }
</style>
