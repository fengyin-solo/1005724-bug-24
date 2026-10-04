<template>
  <section class="page" data-module="secondarycircuit">
    <header class="page-head">
      <div>
        <h2>二次回路检查管理</h2>
        <p class="page-desc">维护回路检查记录，围绕检查编号、所属间隔、回路类别、端子排编号做登记、筛选与状态流转。保护校验判不合格的装置自动进入下方待复核清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记回路检查记录</button>
        <button class="btn" type="button" @click="exportRows">导出二次回路检查清单</button>
      </div>
    </header>

    <div class="review-block">
      <h3>待复核清单（保护校验判不合格驱动）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>复核编号</th>
            <th>关联校验编号</th>
            <th>装置名称</th>
            <th>所属班组</th>
            <th>判定经办人</th>
            <th>来源日期</th>
            <th>复核状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewRows" :key="String(item.id)">
            <td>{{ item['检查编号'] }}</td>
            <td>{{ item['关联校验编号'] }}</td>
            <td>{{ item['装置名称'] }}</td>
            <td>{{ item['所属班组'] }}</td>
            <td>{{ item['判定经办人'] || '—' }}</td>
            <td>{{ item['检查日期'] }}</td>
            <td>{{ item['复核状态'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="acceptReview(item)">受理复核</button>
            </td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td colspan="8" class="empty-state">暂无待复核条目</td>
          </tr>
        </tbody>
      </table>
    </div>

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无二次回路检查数据，可先登记回路检查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条二次回路检查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listPendingReviews, acceptSecondaryReview } from '@/api/relay-test-service'
import type { EntryRow, SecondaryReviewRow } from '@/data/types'

const meta = moduleMeta('secondarycircuit')
const columns = ['检查编号', '所属间隔', '回路类别', '端子排编号', '绝缘电阻', '检查人', '检查日期', '回路状态']
const actions = ['提交检查', '判定合格', '提出整改']
const statuses = ['待检查', '检查中', '检查合格', '需整改', '待复核']
const stats = ref([
  { label: '待检查回路', value: 0 },
  { label: '检查合格回路', value: 0 },
  { label: '需整改回路', value: 0 },
])

const rows = ref<EntryRow[]>([])
const reviewRows = ref<SecondaryReviewRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '回路检查记录登记入口尚未接入审批流'
}

function acceptReview(row: SecondaryReviewRow) {
  errorMessage.value = ''
  const result = acceptSecondaryReview(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reviewRows.value = listPendingReviews()
    stats.value = [
      { label: '待检查回路', value: rows.value.filter((row) => ['待检查', '检查中', '待复核'].includes(String(row.status))).length },
      { label: '检查合格回路', value: rows.value.filter((row) => String(row.status) === '检查合格').length },
      { label: '需整改回路', value: rows.value.filter((row) => String(row.status) === '需整改').length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次回路检查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.review-block {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--brand);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.review-block h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
</style>
