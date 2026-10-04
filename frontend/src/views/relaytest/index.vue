<template>
  <section class="page" data-module="relaytest">
    <header class="page-head">
      <div>
        <h2>保护校验管理</h2>
        <p class="page-desc">
          校验记录按所属班组归属：动作值与返回值仅本班组可改，跨班组一律打回；判不合格整单锁定，须本班组重做校验翻案，并驱动二次回路检查待复核清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记校验记录</button>
        <button class="btn" type="button" @click="exportRows">导出保护校验清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">待二次回路复核：{{ reviewCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>所属班组</th>
          <th>当前状态</th>
          <th>明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row['所属班组'] }}</td>
          <td>
            {{ row.status }}
            <span v-if="isLocked(row)" class="lock-tag">已锁定</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row.id)">查看明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无保护校验数据，可先登记校验记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护校验记录（列表只读，改动在明细面板进行）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 明细面板：名册与这里读的是同一行同一字段，不另存副本，重新打开仍是同一份 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <div class="drawer">
        <div class="drawer-head">
          <h3>校验记录明细 · {{ detail['校验编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </div>

        <div class="detail-banner" :class="ownerOf(detail) ? 'is-owner' : 'is-other'">
          当前身份：{{ store.team }} / {{ store.operator }} ；
          该记录归属：{{ detail['所属班组'] }}
          <template v-if="ownerOf(detail)">（本班组，可在规则内改动）</template>
          <template v-else>（非本班组，动作值/返回值与流转一律只读）</template>
        </div>

        <dl class="detail-grid">
          <div v-for="field in detailFields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd>{{ detail[field] || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>校验轮次</dt>
            <dd>第 {{ detail['校验轮次'] }} 轮</dd>
          </div>
        </dl>

        <div v-if="isLocked(detail)" class="lock-banner">
          该记录已判「校验不合格」并整条锁定为只读；要翻案须由{{ detail['所属班组'] }}重做校验。
        </div>

        <form v-if="canEditValues(detail)" class="detail-form" @submit.prevent="saveValues">
          <h4>修改动作值 / 返回值（仅本班组，留痕经办人）</h4>
          <label class="filter-item">
            <span>动作值</span>
            <input v-model="valueForm.动作值" />
          </label>
          <label class="filter-item">
            <span>返回值</span>
            <input v-model="valueForm.返回值" />
          </label>
          <button class="btn primary" type="submit">保存数值</button>
        </form>

        <div class="detail-actions">
          <button
            v-for="action in availableActions(detail)"
            :key="action"
            class="btn"
            type="button"
            @click="doAction(action)"
          >
            {{ action }}
          </button>
          <span v-if="!availableActions(detail).length" class="muted-text">当前状态/归属下无可执行动作</span>
        </div>

        <div class="change-log">
          <h4>改动记录</h4>
          <table v-if="detail['变更记录'].length" class="data-table">
            <thead>
              <tr><th>时间</th><th>经办人</th><th>班组</th><th>项</th><th>原值</th><th>新值</th></tr>
            </thead>
            <tbody>
              <tr v-for="(log, index) in detail['变更记录']" :key="index">
                <td>{{ log.time }}</td>
                <td>{{ log.operator }}</td>
                <td>{{ log.team }}</td>
                <td>{{ log.field }}</td>
                <td>{{ log.before || '—' }}</td>
                <td>{{ log.after || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted-text">暂无改动记录</p>
        </div>
      </div>
    </div>

    <!-- 登记：新记录归属当前班组 -->
    <div v-if="creating" class="drawer-mask" @click.self="creating = false">
      <div class="drawer">
        <div class="drawer-head">
          <h3>登记校验记录（归属：{{ store.team }}）</h3>
          <button class="btn ghost" type="button" @click="creating = false">关闭</button>
        </div>
        <form class="detail-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field" class="filter-item">
            <span>{{ field }}</span>
            <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
          </label>
          <button class="btn primary" type="submit">提交登记</button>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createRelayEntry,
  exportRelayBook,
  getRelayRow,
  isLocked,
  loadRelayRows,
  transitRelay,
  updateRelayValues,
  type OperatorContext,
  type RelayDraft,
} from '@/api/relay-test-service'
import { downloadText } from '@/api/download'
import { useSessionStore } from '@/stores/session'
import type { RelayTestRow } from '@/data/types'

const store = useSessionStore()

const columns = ['校验编号', '装置名称', '校验项目', '动作值', '返回值', '校验人', '校验日期']
const detailFields = [
  '校验编号',
  '装置名称',
  '校验项目',
  '动作值',
  '返回值',
  '校验人',
  '经办人',
  '提交时间',
  '校验日期',
  '校验状态',
]
const createFields = ['校验编号', '装置名称', '校验项目', '动作值', '返回值']
const statuses = ['待校验', '校验中', '校验合格', '校验不合格']

const rows = ref<RelayTestRow[]>([])
const total = ref(0)
const reviewCount = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const detailId = ref<number | null>(null)
// 明细每次都从单一数据源按 id 重新取，保证与名册/导出同源，不持副本。
const detail = ref<RelayTestRow | null>(null)
const valueForm = reactive({ 动作值: '', 返回值: '' })

const creating = ref(false)
const createForm = reactive<Record<string, string>>({
  校验编号: '',
  装置名称: '',
  校验项目: '',
  动作值: '',
  返回值: '',
})

const stats = computed(() => [
  { label: '待校验装置', value: countByStatus(['待校验', '校验中']) },
  { label: '校验合格装置', value: countByStatus(['校验合格']) },
  { label: '校验不合格装置', value: countByStatus(['校验不合格']) },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)

function countByStatus(list: string[]): number {
  return rows.value.filter((row) => list.includes(String(row.status))).length
}

function ctx(): OperatorContext {
  return { team: store.team, operator: store.operator || '值班管理员' }
}

function ownerOf(row: RelayTestRow): boolean {
  return row['所属班组'] === store.team
}

// 数值只在「本班组 + 未锁定」时可改；判过不合格的整条只读。
function canEditValues(row: RelayTestRow): boolean {
  return ownerOf(row) && !isLocked(row)
}

function availableActions(row: RelayTestRow): string[] {
  if (!ownerOf(row)) {
    return []
  }
  switch (String(row.status)) {
    case '待校验':
      return ['提交校验']
    case '校验中':
      return ['判定合格', '标记不合格']
    case '校验不合格':
      return ['重做校验']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportRelayBook()
  downloadText(filename, content)
}

function openCreate() {
  for (const field of createFields) {
    createForm[field] = ''
  }
  creating.value = true
}

function submitCreate() {
  const draft: RelayDraft = {
    校验编号: createForm['校验编号'],
    装置名称: createForm['装置名称'],
    校验项目: createForm['校验项目'],
    动作值: createForm['动作值'],
    返回值: createForm['返回值'],
  }
  const result = createRelayEntry(draft, ctx())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = ''
  reload()
}

function openDetail(id: number) {
  detailId.value = id
  refreshDetail()
}

function refreshDetail() {
  if (detailId.value === null) {
    return
  }
  detail.value = getRelayRow(detailId.value) ?? null
  if (detail.value) {
    valueForm.动作值 = detail.value.动作值
    valueForm.返回值 = detail.value.返回值
  }
}

function closeDetail() {
  detailId.value = null
  detail.value = null
}

function saveValues() {
  if (!detail.value) {
    return
  }
  const result = updateRelayValues(
    Number(detail.value.id),
    { 动作值: valueForm.动作值, 返回值: valueForm.返回值 },
    ctx(),
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
  refreshDetail()
}

function doAction(action: string) {
  if (!detail.value) {
    return
  }
  const result = transitRelay(Number(detail.value.id), action, ctx())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
  refreshDetail()
}

function applyFilter(list: RelayTestRow[]): RelayTestRow[] {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (!pairs.length) {
    return list
  }
  return list.filter((row) => pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())))
}

function reload() {
  errorMessage.value = ''
  const all = loadRelayRows()
  rows.value = applyFilter(all)
  total.value = rows.value.length
  reviewCount.value = all.filter((row) => String(row.status) === '校验不合格').length
  // 明细面板若开着，重新进入也只认同一数据源里的同一条，不换一份。
  if (detailId.value !== null) {
    refreshDetail()
  }
}

onMounted(reload)
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}
.drawer {
  width: 720px;
  max-width: 92vw;
  height: 100%;
  background: #fff;
  padding: 16px 20px;
  overflow: auto;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-banner {
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  margin: 10px 0;
}
.detail-banner.is-owner {
  background: #ecfdf3;
  border: 1px solid #abefc6;
}
.detail-banner.is-other {
  background: #fef3f2;
  border: 1px solid #fda29b;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 16px;
  margin: 8px 0;
}
.detail-item dt {
  color: var(--muted);
  font-size: 12px;
}
.detail-item dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.lock-tag {
  margin-left: 6px;
  background: #fef3f2;
  color: #b42318;
  border-radius: 4px;
  padding: 0 6px;
  font-size: 12px;
}
.lock-banner {
  background: #fef3f2;
  border: 1px solid #fda29b;
  color: #b42318;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  margin: 10px 0;
}
.detail-form {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
}
.detail-form h4,
.change-log h4 {
  width: 100%;
  margin: 6px 0;
}
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.change-log {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
</style>
