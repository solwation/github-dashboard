<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, CircleCheck, Clock3, Layers3 } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { boardEntryKey, type BoardEntry } from "../lib/combined-board";
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
    estimateGroups?: { issues: Issue[]; rules?: Rules }[];
    sort?: ColumnSort;
    loading?: boolean;
    showCount?: boolean;
    showEmpty?: boolean;
    filtered?: boolean;
    showRepository?: boolean;
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
    estimateGroups: () => [],
    sort: "default",
    loading: false,
    showCount: undefined,
    showEmpty: undefined,
    filtered: false,
    showRepository: false,
  },
);

const emit = defineEmits<{
  "update:sort": [value: ColumnSort];
  showMore: [increment: number];
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
</script>

<template>
  <section
    :id="id"
    tabindex="-1"
    :aria-label="ariaLabel"
    class="board-column"
    :class="column.key"
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
      <ColumnSortMenu
        :column="column.key"
        :model-value="sort"
        @update:model-value="emit('update:sort', $event)"
      />
    </div>
    <div class="cards">
      <ul v-if="listMode && items.length" class="issue-rows">
        <IssueRow
          v-for="{ lane, issue } in visibleEntries"
          :key="boardEntryKey({ lane, issue }, column.key)"
          :id="issueDomId(lane.repo.full_name, issue.number)"
          :data-repository="lane.repo.full_name"
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
          v-bind="cardProps(lane, issue, showRepository)"
          show-time-explanation
          @read="emit('read', lane.repo.full_name, issue)"
          @parent-select="(repo, num) => emit('parentSelect', repo, num)"
          @child-select="(repo, num) => emit('childSelect', repo, num)"
        />
      </template>
      <div v-if="shouldShowEmpty" class="column-empty">
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
      <button
        v-if="limit !== undefined && items.length > limit"
        class="show-more"
        @click="emit('showMore', limitIncrement)"
      >
        {{ t("Visa fler") }} <ChevronDown :size="14" />
      </button>
    </div>
  </section>
</template>
