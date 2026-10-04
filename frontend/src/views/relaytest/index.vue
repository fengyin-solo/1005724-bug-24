<template>
  <section class="page" data-module="relaytest">
    <header class="page-head">
      <div>
        <h2>保护校验管理</h2>
        <p class="page-desc">动作值与返回值按记录归属班组设限；判过不合格的记录整条锁定，须由本班组重做校验。列表仅供查看，改动一律在明细面板办理。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出保护校验清册</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待校验装置（最新一轮）</span>
        <strong class="stat-value">{{ counts['待校验'] + counts['校验中'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">校验合格装置</span>
        <strong class="stat-value">{{ counts['校验合格'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">校验不合格装置（待复核 {{ pendingReviews }}）</span>
        <strong class="stat-value danger">{{ counts['校验不合格'] }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="status in statuses" :key="status" class="legend-item">
        {{ status }}：{{ counts[status] }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>所属班组</span>
        <select v-model="filters['所属班组']">
          <option value="">全部班组</option>
          <option v-for="team in teams" :key="team" :value="team">{{ team }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>明细</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'row-selected': selectedId === Number(row.id), 'row-locked': isLocked(row) }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="['status-badge', badgeClass(String(row.status))]">{{ row.status }}</span>
            <span v-if="Number(row.round) > 1" class="round-tag">第{{ row.round }}轮</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">没有符合条件的校验记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条校验记录（名册只读，数值改动请到明细面板办理）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="selected" class="detail-mask" @click.self="closeDetail">
      <section class="detail-panel">
        <header class="detail-head">
          <div>
            <h3>校验记录明细 · {{ selected['校验编号'] }}
              <span v-if="Number(selected.round) > 1" class="round-tag">第{{ selected.round }}轮重做</span>
            </h3>
            <p class="page-desc">本面板与名册、导出清册读的是同一份数据，返回值不会两处不一致。</p>
          </div>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <div class="detail-grid">
          <label class="detail-item readonly">
            <span>装置名称</span>
            <input :value="selected['装置名称']" readonly />
          </label>
          <label class="detail-item readonly">
            <span>校验项目</span>
            <input :value="selected['校验项目']" readonly />
          </label>
          <label class="detail-item readonly">
            <span>所属班组</span>
            <input :value="selected['所属班组']" readonly />
          </label>
          <label class="detail-item readonly">
            <span>校验日期</span>
            <input :value="selected['校验日期']" readonly />
          </label>
          <label class="detail-item" :class="{ disabled: !canEdit }">
            <span>动作值</span>
            <input v-model="actionValue" :disabled="!canEdit" placeholder="如 5.20 A" />
          </label>
          <label class="detail-item" :class="{ disabled: !canEdit }">
            <span>返回值</span>
            <input v-model="returnValue" :disabled="!canEdit" placeholder="如 4.68 A" />
          </label>
        </div>

        <p v-if="lockReasonText" class="guard-banner" :class="isOwner ? 'warn' : 'deny'">
          {{ lockReasonText }}
        </p>
        <p v-else class="guard-banner allow">
          当前账号「{{ store.operator }}」属{{ store.team }}，与记录归属一致，可在结论固化前修改动作值与返回值。
        </p>

        <div class="detail-actions">
          <button class="btn primary" type="button" :disabled="!canEdit" @click="saveValues">保存数值改动</button>
          <button
            class="btn"
            type="button"
            :disabled="!isOwner || isLocked(selected) || String(selected.status) === '校验合格'"
            @click="submitVerify"
          >
            提交校验
          </button>
          <button
            class="btn"
            type="button"
            :disabled="!isOwner || String(selected.status) !== '校验中'"
            @click="judge(true)"
          >
            判定合格
          </button>
          <button
            class="btn danger"
            type="button"
            :disabled="!isOwner || String(selected.status) !== '校验中'"
            @click="judge(false)"
          >
            判定不合格
          </button>
          <button
            v-if="isLocked(selected) && isOwner"
            class="btn warn"
            type="button"
            @click="redo"
          >
            本班组重做校验（另起一轮）
          </button>
        </div>
        <p v-if="detailMessage" class="detail-message" :class="detailOk ? 'ok-text' : 'error-text'">
          {{ detailMessage }}
        </p>

        <section class="log-section">
          <h4>改动记录（经办人留痕）</h4>
          <table class="data-table log-table" v-if="logs.length">
            <thead>
              <tr><th>时间</th><th>经办人</th><th>班组</th><th>操作</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="(log, index) in logs" :key="index">
                <td>{{ log.at }}</td>
                <td>{{ log.operator }}</td>
                <td>{{ log.team }}</td>
                <td>{{ log.action }}</td>
                <td>{{ log.detail ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="page-desc">暂无改动记录。</p>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  canEditValues,
  downloadRelayBook,
  getRelayRow,
  isLocked,
  judgeRelay,
  listRelayRows,
  listReviewItems,
  redoRelayVerify,
  relayLogs,
  relayStatusCounts,
  saveRelayValues,
  submitRelayVerify,
  RELAY_TEAMS,
} from '@/data/relay-test'
import { filterRows } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const teams = RELAY_TEAMS
const columns = ["校验编号", "装置名称", "校验项目", "所属班组", "动作值", "返回值", "校验人", "校验日期"]
const filterFields = ["校验编号", "装置名称", "校验项目"]
const statuses = ["待校验", "校验中", "校验合格", "校验不合格"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})

const selectedId = ref<number | null>(null)
const reloadTick = ref(0)
const actionValue = ref('')
const returnValue = ref('')
const detailMessage = ref('')
const detailOk = ref(true)

const selected = computed(() => {
  void reloadTick.value
  return selectedId.value === null ? null : getRelayRow(selectedId.value) ?? null
})
const logs = computed(() => (selected.value ? relayLogs(selected.value) : []))
const isOwner = computed(() =>
  selected.value ? String(selected.value['所属班组']) === store.team : false,
)
const canEdit = computed(() =>
  selected.value ? canEditValues(selected.value, store.team) : false,
)
const lockReasonText = computed(() =>
  selected.value && !canEdit.value
    ? selected.value['所属班组'] !== store.team
      ? `跨班组改动一律打回：该记录归属「${selected.value['所属班组']}」，当前账号属「${store.team}」，动作值与返回值仅归属班组可改。`
      : isLocked(selected.value)
        ? '该记录已判定不合格，整条锁定为只读；要翻案须由本班组重做校验，不能直接改写原数值。'
        : '该记录已判定合格，动作值与返回值随结论固化，不能再改。'
    : '',
)
const counts = computed(() => relayStatusCounts())
const pendingReviews = computed(() => listReviewItems().filter((item) => item.state === '待复核').length)

function badgeClass(status: string): string {
  if (status === '校验合格') return 'badge-ok'
  if (status === '校验不合格') return 'badge-bad'
  if (status === '校验中') return 'badge-doing'
  return 'badge-todo'
}

function resetFilters() {
  for (const key of Object.keys(filters)) delete filters[key]
  reload()
}

function exportRows() {
  // 导出与明细同源同列，动作值列不会再丢失或错位。
  downloadRelayBook()
}

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
  actionValue.value = String(row['动作值'] ?? '')
  returnValue.value = String(row['返回值'] ?? '')
  detailMessage.value = ''
}

function closeDetail() {
  selectedId.value = null
  detailMessage.value = ''
}

function flash(ok: boolean, message: string) {
  detailOk.value = ok
  detailMessage.value = message
  if (ok) reload()
}

function saveValues() {
  if (!selected.value) return
  const result = saveRelayValues(
    Number(selected.value.id),
    { actionValue: actionValue.value, returnValue: returnValue.value },
    store.operator,
    store.team,
  )
  flash(result.ok, result.message)
  if (result.ok && selected.value) {
    const fresh = getRelayRow(Number(selected.value.id))
    if (fresh) {
      actionValue.value = String(fresh['动作值'] ?? '')
      returnValue.value = String(fresh['返回值'] ?? '')
    }
  }
}

function submitVerify() {
  if (!selected.value) return
  const result = submitRelayVerify(Number(selected.value.id), store.operator, store.team)
  flash(result.ok, result.message)
}

function judge(pass: boolean) {
  if (!selected.value) return
  const result = judgeRelay(Number(selected.value.id), pass, store.operator, store.team)
  flash(result.ok, result.message)
}

function redo() {
  if (!selected.value) return
  const result = redoRelayVerify(Number(selected.value.id), store.operator, store.team)
  flash(result.ok, result.message)
  if (result.ok && result.recordId) {
    openDetail(getRelayRow(result.recordId) as EntryRow)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = filterRows(listRelayRows(), filters)
    total.value = rows.value.length
    reloadTick.value++
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护校验列表读取失败'
  }
}

onMounted(reload)
</script>
