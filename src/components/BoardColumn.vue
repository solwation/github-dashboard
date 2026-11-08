<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown, ChevronUp, CircleCheck, Clock3, Layers3 } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { boardEntryKey, type BoardEntry } from "../lib/combined-board";
import { canCollapseColumn } from "../lib/column-limits";
import { issueDomId } from "../lib/issue-navigation";
import type { ColumnSort, Issue, Lane, Rules } from "../lib/model";
import ColumnEstimate from "./ColumnEstimate.vue";
import ColumnSortMenu from "./ColumnSortMenu.vue";
import IssueCard from "./IssueCard.vue";
import IssueRow from "./IssueRow.vue";

export interface CardPropsResult {
  issue: Issue;
  rules: Rules;
  repository?: string;
  showRepository?: boolean;
  assignedColor?: string;
  defaultExpanded?: boolean;
  rowDetails?: boolean;
  showTimeExplanation?: boolean;
  loadRelations?: (issue: Issue) => Promise<any>;
  relationsRevision?: number;
  loadCommit?: (issue: Issue) => Promise<any>;
  loadComments?: (issue: Issue) => Promise<any>;
  commentsSession?: number;
  commitRetry?: number;
  recentMove?: any;
  newComments?: number;
  timedOut?: boolean;
  timeoutOverrunPercent?: number;
  timeoutEstimateMs?: number;
  demo?: boolean;
  celebrate?: boolean;
  [key: string]: any;
}

export interface RowPropsResult {
  issue: Issue;
  rules: Rules;
  repository: string;
  showRepository?: boolean;
  assignedColor?: string;
  demo?: boolean;
  celebrate?: boolean;
  recentMove?: any;
  newComments?: number;
  timedOut?: boolean;
  timeoutOverrunPercent?: number;
  timeoutEstimateMs?: number;
  loadRelations?: (issue: Issue) => Promise<any>;
  relationsRevision?: number;
  commentsSession?: number;
  navigationRevision?: number;
  loadComments?: (issue: Issue) => Promise<any>;
  [key: string]: any;
}

const props = withDefaults(
  defineProps<{
    column: { key: string; title: string };
    items: (Issue | BoardEntry)[];
    lane?: Lane;
    id?: string;
    ariaLabel?: string;
    listMode?: boolean;
    limit?: number;
    limitIncrement?: number;
    baseLimit?: number;
    estimateGroups?: { issues: Issue[]; rules?: Rules }[];
    sort?: ColumnSort;
    loading?: boolean;
    showCount?: boolean;
    showEmpty?: boolean;
    filtered?: boolean;
    showRepository?: boolean;
    selectedRepository?: string | null;
    /** Swimlanes (#390): the shared status header row above the lanes renders only the header. */
    headerOnly?: boolean;
    floatingSort?: boolean;
    /** Swimlanes (#390): one repository's status cell inside a lane. */
    cell?: boolean;
    cardProps: (lane: Lane, issue: Issue, showRepository?: boolean) => CardPropsResult;
    rowProps: (lane: Lane, issue: Issue, showRepository?: boolean) => RowPropsResult;
  }>(),
  {
    lane: undefined,
    id: undefined,
    ariaLabel: undefined,
    listMode: false,
    limit: undefined,
    limitIncrement: 10,
    baseLimit: undefined,
    estimateGroups: () => [],
    sort: "default",
    loading: false,
    showCount: undefined,
    showEmpty: undefined,
    filtered: false,
    showRepository: false,
    selectedRepository: null,
    headerOnly: false,
    floatingSort: false,
    cell: false,
  },
);

const emit = defineEmits<{
  "update:sort": [value: ColumnSort];
  showMore: [increment: number];
  collapse: [];
  read: [repository: string, issue: Issue];
  parentSelect: [repository: string, number: number];
  childSelect: [repository: string, number: number];
}>();

const { t } = useLanguage();

const columnEntries = computed<BoardEntry[]>(() => {
  if (!props.items) return [];
  if (props.lane) {
    const lane = props.lane;
    return (props.items as Issue[]).map((issue) => ({ lane, issue }));
  }
  return props.items as BoardEntry[];
});

const visibleEntries = computed<BoardEntry[]>(() => {
  const entries = columnEntries.value;
  return props.limit !== undefined ? entries.slice(0, props.limit) : entries;
});

const shouldShowCount = computed(() => {
  if (props.showCount !== undefined) return props.showCount;
  return !props.loading || (props.items && props.items.length > 0);
});

const shouldShowEmpty = computed(() => {
  if (props.showEmpty !== undefined) return props.showEmpty;
  return (!props.items || props.items.length === 0) && !props.loading;
});

// #439: an empty column's placeholder takes the height of a real issue in the same view
// (the first card in Cards, the first row in List), nearest lane first, so it matches
// across breakpoints and content instead of a fixed guess. Without any issue to match,
// the stylesheet's default size applies.
const emptyBox = ref<HTMLElement>();
const matchedHeight = ref<number>();
let measuredItem: Element | null = null;
let itemObserver: ResizeObserver | undefined;
let scopeObserver: MutationObserver | undefined;
let measureFrame = 0;
// Coalesce bursts (Vue re-renders, ticking timers) into one layout read per frame.
function scheduleMeasure() {
  if (measureFrame) return;
  measureFrame = requestAnimationFrame(() => { measureFrame = 0; measureEmpty(); });
}

function representativeItem(el: HTMLElement): Element | null {
  const selector = props.listMode ? ".issue-row" : ".issue-card";
  const visible = (item: Element | null | undefined) => item && item.getBoundingClientRect().height > 0 ? item : null;
  const scope = el.closest(".swimlane, .swimlane-table, .combined-board");
  return visible(scope?.querySelector(selector)) ?? visible(document.querySelector(`.board-column ${selector}`));
}

function measureEmpty() {
  const el = emptyBox.value;
  if (!el) return;
  const item = representativeItem(el);
  if (item !== measuredItem) {
    itemObserver?.disconnect();
    if (item) itemObserver?.observe(item);
    measuredItem = item;
  }
  const height = item?.getBoundingClientRect().height;
  matchedHeight.value = height ? Math.round(height * 100) / 100 : undefined;
}

function stopMeasuring() {
  itemObserver?.disconnect();
  scopeObserver?.disconnect();
  if (measureFrame) cancelAnimationFrame(measureFrame);
  measureFrame = 0;
  itemObserver = scopeObserver = undefined;
  measuredItem = null;
  matchedHeight.value = undefined;
}

watch(emptyBox, (el) => {
  stopMeasuring();
  if (!el || typeof ResizeObserver === "undefined") return;
  itemObserver = new ResizeObserver(scheduleMeasure);
  // Cards and rows appear, move or switch mode elsewhere in the lane/board.
  const scope = el.closest(".swimlane, .swimlane-table, .combined-board, main") ?? document.body;
  scopeObserver = new MutationObserver(scheduleMeasure);
  scopeObserver.observe(scope, { childList: true, subtree: true });
  measureEmpty();
});
watch(() => props.listMode, () => measureEmpty(), { flush: "post" });
onBeforeUnmount(stopMeasuring);

const canCollapse = computed(() => {
  return canCollapseColumn(props.limit, props.baseLimit, props.items?.length ?? 0);
});

const collapseLabel = computed(() =>
  props.lane
    ? t("Fäll ihop {column} i {repository} till {count} issues", { column: props.column.title, repository: props.lane.repo.full_name, count: props.baseLimit ?? 0 })
    : t("Fäll ihop {column} till {count} issues", { column: props.column.title, count: props.baseLimit ?? 0 }),
);
</script>

<template>
  <section
    :id="id"
    tabindex="-1"
    :aria-label="ariaLabel"
    class="board-column"
    :class="[column.key, { 'swimlane-cell': cell, 'swimlane-head-cell': headerOnly }]"
  >
    <div class="column-header">
      <div class="column-heading">
        <i :class="column.key" />{{ column.title
        }}<span v-if="shouldShowCount" class="column-count">{{
          items.length
        }}</span
        ><ColumnEstimate
          v-if="column.key !== 'closed'"
          :groups="estimateGroups"
          :column="column.key as 'progress' | 'backlog'"
        />
      </div>
      <div class="column-header-actions">
        <button
          v-if="canCollapse && !cell"
          type="button"
          class="column-collapse-button"
          :aria-label="collapseLabel"
          :title="t('Fäll ihop till {count} issues', { count: baseLimit ?? 0 })"
          @click="emit('collapse')"
        >
          <ChevronUp :size="12" aria-hidden="true" />
          <span>{{ t("Fäll ihop") }}</span>
        </button>
        <ColumnSortMenu
          :floating="floatingSort"
          :column="column.key"
          :model-value="sort"
          @update:model-value="emit('update:sort', $event)"
        />
      </div>
    </div>
    <div v-if="!headerOnly" class="cards">
      <ul v-if="listMode && items.length" class="issue-rows">
        <IssueRow
          v-for="{ lane, issue } in visibleEntries"
          :key="boardEntryKey({ lane, issue }, column.key)"
          :id="issueDomId(lane.repo.full_name, issue.number)"
          :data-repository="lane.repo.full_name"
          :class="{ 'repository-selected': lane.repo.full_name === selectedRepository }"
          v-bind="rowProps(lane, issue, showRepository)"
          @read="emit('read', lane.repo.full_name, issue)"
          v-slot="{ inPopup }"
        >
          <IssueCard
            v-bind="cardProps(lane, issue, showRepository)"
            :row-details="!inPopup"
            show-time-explanation
            :default-expanded="true"
            @read="emit('read', lane.repo.full_name, issue)"
            @parent-select="(repo, num) => emit('parentSelect', repo, num)"
            @child-select="(repo, num) => emit('childSelect', repo, num)"
          />
        </IssueRow>
      </ul>
      <template v-else-if="!listMode">
        <IssueCard
          v-for="{ lane, issue } in visibleEntries"
          :key="boardEntryKey({ lane, issue }, column.key)"
          :id="issueDomId(lane.repo.full_name, issue.number)"
          :data-repository="lane.repo.full_name"
          :class="{ 'repository-selected': lane.repo.full_name === selectedRepository }"
          v-bind="cardProps(lane, issue, showRepository)"
          show-time-explanation
          @read="emit('read', lane.repo.full_name, issue)"
          @parent-select="(repo, num) => emit('parentSelect', repo, num)"
          @child-select="(repo, num) => emit('childSelect', repo, num)"
        />
      </template>
      <div
        v-if="shouldShowEmpty"
        ref="emptyBox"
        class="column-empty"
        :class="{ matched: matchedHeight }"
        :style="matchedHeight ? { '--matched-height': matchedHeight + 'px' } : undefined"
      >
        <CircleCheck v-if="column.key === 'closed'" :size="20" /><Clock3
          v-else-if="column.key === 'progress'"
          :size="20"
        /><Layers3 v-else :size="20" /><span>{{
          filtered
            ? t("Inga issues matchar filtren")
            : column.key === "progress"
            ? t("Inget pågående arbete")
            : column.key === "closed"
              ? t("Inga stängda issues ännu")
              : t("Backloggen är tom")
        }}</span>
      </div>
      <div v-if="cell && limit !== undefined && (items.length > limit || canCollapse)" class="column-more-row">
        <button
          v-if="items.length > limit"
          type="button"
          class="show-more"
          @click="emit('showMore', limitIncrement)"
        >
          {{ t("Visa fler") }} <ChevronDown :size="14" />
        </button>
        <button
          v-if="canCollapse"
          type="button"
          class="column-collapse-button"
          :aria-label="collapseLabel"
          :title="t('Fäll ihop till {count} issues', { count: baseLimit ?? 0 })"
          @click="emit('collapse')"
        >
          <ChevronUp :size="12" aria-hidden="true" />
          <span>{{ t("Fäll ihop") }}</span>
        </button>
      </div>
      <button
        v-else-if="limit !== undefined && items.length > limit"
        type="button"
        class="show-more"
        @click="emit('showMore', limitIncrement)"
      >
        {{ t("Visa fler") }} <ChevronDown :size="14" />
      </button>
    </div>
  </section>
</template>
