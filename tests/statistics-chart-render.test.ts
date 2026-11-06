import { afterEach, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type ChartComponent from '../src/components/StatisticsChart.vue';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import * as i18n from '../src/lib/i18n';
import * as browserTime from '../src/lib/browser-time';
import * as chartHelpers from '../src/lib/statistics-chart';
// Vitest's default SFC transform targets SSR. Compile the same SFC with its client
// render function so the host renderer can dispatch actual interaction handlers.
const source = readFileSync(new URL('../src/components/StatisticsChart.vue', import.meta.url), 'utf8');
const script = compileScript(parse(source).descriptor, { id: 'chart-regression', inlineTemplate: true }).content;
const compiled = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies: Record<string, unknown> = { vue: Vue, '../lib/i18n': i18n, '../lib/browser-time': browserTime, '../lib/statistics-chart': chartHelpers };
const componentModule = { exports: {} as { default: typeof ChartComponent } };
new Function('require', 'exports', compiled)((name: string) => {
  if (!(name in dependencies)) throw new Error(`Unexpected chart dependency: ${name}`);
  return dependencies[name];
}, componentModule.exports);
const StatisticsChart = componentModule.exports.default;
import type { StatisticsDay, StatisticsMetric, StatisticsResolution } from '../src/lib/statistics';
import { locale, setLanguage } from '../src/lib/i18n';

// A host renderer exercises the actual SFC's computed/render boundary without browser timing.
type Node = { type: string; text: string; props: Record<string, any>; children: Node[]; parent: Node | null };
function mountChart(props: InstanceType<typeof StatisticsChart>['$props']) {
  let width = 790;
  const nodes: Node[] = [];
  const node = (type: string, text = ''): Node => Object.assign({ type, text, props: {}, children: [], parent: null }, {
    addEventListener() {}, removeEventListener() {}, getAttribute() { return null; }, getRootNode() { return {}; },
    getBoundingClientRect() { return { width, left: 0 }; },
  });
  const renderer = createRenderer<Node, Node>({
    createElement(type) { const element = node(type); nodes.push(element); return element; },
    createText: text => node('#text', text), createComment: text => node('#comment', text),
    setText(n, text) { n.text = text; }, setElementText(n, text) { n.text = text; },
    patchProp(n, key, _old, value) { n.props[key] = value; },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(n); else parent.children.splice(index, 0, n);
    },
    remove(n) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  });
  const resize = vi.fn();
  vi.stubGlobal('window', { innerHeight: 900, addEventListener: (_name: string, callback: () => void) => resize.mockImplementation(callback), removeEventListener() {} });
  vi.stubGlobal('Document', class {});
  vi.stubGlobal('ShadowRoot', class {});
  const app = renderer.createApp({ render: () => h(StatisticsChart, props) });
  app.mount(node('root'));
  return { nodes, app, resize: (value: number) => { width = value; resize(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLanguage('auto'); });

it('reuses 720-bucket three-series titles and geometry for pointer, touch and keyboard selection (#418)', async () => {
  setLanguage('sv');
  const format = vi.fn((value: number) => `${value.toLocaleString(locale.value)} units`);
  const dateFormats = vi.spyOn(Date.prototype, 'toLocaleDateString');
  const timeFormats = vi.spyOn(Date.prototype, 'toLocaleTimeString');
  const geometryOperations = vi.spyOn(Math, 'max');
  const days: StatisticsDay[] = Array.from({ length: 720 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 10, 1) + index * 3600000).toISOString().slice(0, 16).replace('T', ' '),
    values: { closed: index % 5, created: index === 12 ? undefined : index % 3, commits: index % 8 },
  }));
  const props = reactive({ series: (['closed', 'created', 'commits'] as StatisticsMetric[]).map(metric => ({ metric, name: metric, days, format })), metric: 'closed' as StatisticsMetric, title: 'Dense chart', resolution: '1h' as StatisticsResolution });
  const { nodes, app, resize } = mountChart(props);
  try {
    await nextTick();
    // Shared timestamp labels are formatted once, rather than once per metric.
    expect(dateFormats.mock.calls.length).toBeLessThan(740);
    expect(timeFormats.mock.calls.length).toBeLessThan(740);
    expect(geometryOperations.mock.calls.length).toBeGreaterThan(4000);
    const svg = nodes.find(n => n.type === 'svg')!;
    const slider = nodes.find(n => n.type === 'input')!;
    const lines = nodes.filter(n => n.type === 'polyline');
    const titles = nodes.filter(n => n.type === 'title' && n.text.includes(' · '));
    expect(lines).toHaveLength(4); // One missing created bucket breaks its line in two.
    expect(nodes.filter(n => n.type === 'circle' && n.parent?.parent === svg)).toHaveLength(2159);
    expect(titles.some(n => n.text.endsWith(': 0 units'))).toBe(true);
    const originalLines = lines.map(n => n.props.points);
    const originalTitles = titles.map(n => n.text);
    for (const action of [
      () => svg.props.onPointermove({ clientX: 200, pointerType: 'mouse' }),
      () => svg.props.onPointermove({ clientX: 300, pointerType: 'mouse' }),
      () => svg.props.onPointerleave(),
      () => svg.props.onPointerdown({ clientX: 400, pointerType: 'touch' }),
      () => { slider.props['onUpdate:modelValue'](719); slider.props.onFocus(); },
      () => slider.props.onBlur(),
    ]) {
      dateFormats.mockClear(); timeFormats.mockClear(); format.mockClear(); geometryOperations.mockClear();
      action(); await nextTick();
      expect(dateFormats).not.toHaveBeenCalled();
      expect(timeFormats).not.toHaveBeenCalled();
      expect(format.mock.calls.length).toBeLessThanOrEqual(3);
      expect(geometryOperations.mock.calls.length).toBeLessThan(100);
      expect(lines.map(n => n.props.points)).toEqual(originalLines);
      expect(titles.map(n => n.text)).toEqual(originalTitles);
    }
    format.mockClear(); dateFormats.mockClear();
    resize(1000); await nextTick();
    expect(lines[0]!.props.points).not.toBe(originalLines[0]);
    expect(format).not.toHaveBeenCalled();
    // Resize may relabel the small axis tick set, but never all point titles.
    expect(dateFormats.mock.calls.length).toBeLessThanOrEqual(12);
    expect(dateFormats.mock.calls.every(([, options]) => !options?.year)).toBe(true);
    setLanguage('en'); await nextTick();
    expect(titles[0]!.text).not.toBe(originalTitles[0]);
    expect(format.mock.calls.length).toBeGreaterThanOrEqual(2159);
    props.resolution = '1d'; await nextTick();
    expect(titles[0]!.text).not.toMatch(/00:00/);
    props.series[0]!.days[0]!.values.closed = 99; await nextTick();
    expect(titles[0]!.text).toContain('99 units');
    props.series[0]!.metric = 'commits'; await nextTick();
    expect(titles[0]!.text).toContain('0 units');
    props.series[0]!.format = vi.fn(value => `changed ${value}`); await nextTick();
    expect(titles[0]!.text).toContain('changed 0');
    props.series[0]!.days[0]!.start = Date.UTC(2026, 11, 1); await nextTick();
    expect(titles[0]!.text).toContain('Dec');
  } finally { app.unmount(); }
});
