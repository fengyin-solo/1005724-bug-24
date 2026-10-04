<template>
  <section class="page" data-module="secondarycircuit">
    <header class="page-head">
      <div>
        <h2>二次回路检查管理</h2>
        <p class="page-desc">维护回路检查记录；保护校验判定不合格的结论会自动进入下方待复核清单，复核处理后方可闭环。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记回路检查记录</button>
        <button class="btn" type="button" @click="exportRows">导出二次回路检查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待复核（保护校验不合格驱动）</span>
        <strong class="stat-value danger">{{ pendingCount }}</strong>
      </article>
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="review-section">
      <h3>保护校验不合格 · 待复核清单</h3>
      <p class="page-desc">
        清单由保护校验的不合格结论自动生成，不能手工增删；本班组重做校验判合格后自动闭环。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>校验编号</th>
            <th>装置名称</th>
            <th>校验项目</th>
            <th>归属班组</th>
            <th>动作值 / 返回值</th>
            <th>结论</th>
            <th>复核意见</th>
            <th>复核人/时间</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewItems" :key="item.relay.id">
            <td>{{ item.relay['校验编号'] }}<span v-if="Number(item.relay.round) > 1" class="round-tag">第{{ item.relay.round }}轮</span></td>
            <td>{{ item.relay['装置名称'] }}</td>
            <td>{{ item.relay['校验项目'] }}</td>
            <td>{{ item.relay['所属班组'] }}</td>
            <td>{{ item.relay['动作值'] }} / {{ item.relay['返回值'] }}</td>
            <td><span class="status-badge badge-bad">{{ item.relay.status }}</span></td>
            <td class="review-opinion">
              <textarea
                v-model="opinions[Number(item.relay.id)]"
                :disabled="item.state !== '待复核'"
                rows="2"
                placeholder="如：已检查跳闸回路端子，紧固后复测正常"
              ></textarea>
            </td>
            <td>
              <template v-if="item.review">
                {{ item.review.operator }}（{{ item.review.team }}）<br />
                <span class="page-desc">{{ item.review.at }}</span><br />
                <span class="page-desc">意见：{{ item.review.opinion }}</span>
              </template>
              <span v-else class="page-desc">尚未复核</span>
            </td>
            <td>
              <span :class="['status-badge', reviewBadge(item.state)]">{{ item.state }}</span>
              <button
                v-if="item.state === '待复核'"
                class="link"
                type="button"
                @click="submitReview(item.relay)"
              >
                提交复核
              </button>
            </td>
          </tr>
          <tr v-if="!reviewItems.length">
            <td colspan="9" class="empty-state">暂无不合格结论驱动的复核任务</td>
          </tr>
        </tbody>
      </table>
      <p v-if="reviewMessage" class="detail-message" :class="reviewOk ? 'ok-text' : 'error-text'">
        {{ reviewMessage }}
      </p>
    </section>

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
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  listReviewItems,
  pendingReviewCount,
  saveReview,
  type ReviewItem,
} from '@/data/relay-test'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('secondarycircuit')
const columns = ["检查编号", "所属间隔", "回路类别", "端子排编号", "绝缘电阻", "检查人", "检查日期", "回路状态"]
const actions = ["提交检查", "判定合格", "提出整改"]
const statuses = ["待检查", "检查中", "检查合格", "需整改"]
const stats = [{"label": "待检查回路", "value": 0}, {"label": "检查合格回路", "value": 0}, {"label": "需整改回路", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewMessage = ref('')
const reviewOk = ref(true)
const opinions = reactive<Record<number, string>>({})
const refreshTick = ref(0)

const reviewItems = computed<ReviewItem[]>(() => {
  void refreshTick.value
  const items = listReviewItems()
  for (const item of items) {
    if (opinions[Number(item.relay.id)] === undefined && item.review) {
      opinions[Number(item.relay.id)] = item.review.opinion
    }
  }
  return items
})
const pendingCount = computed(() => {
  void refreshTick.value
  return pendingReviewCount()
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function reviewBadge(state: ReviewItem['state']): string {
  if (state === '待复核') return 'badge-bad'
  if (state === '已闭环') return 'badge-ok'
  return 'badge-doing'
}

function submitReview(relay: EntryRow) {
  reviewOk.value = false
  const result = saveReview(
    Number(relay.id),
    opinions[Number(relay.id)] ?? '',
    store.operator,
    store.team,
  )
  reviewOk.value = result.ok
  reviewMessage.value = result.message
  if (result.ok) refreshTick.value++
}

function resetFilters() {
  for (const key of Object.keys(filters)) delete filters[key]
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '回路检查记录登记入口尚未接入审批流'
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
    const payload = listEntries(meta.key, filters)
    rows.value = payload.items
    total.value = payload.total
    refreshTick.value++
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次回路检查列表读取失败'
  }
}

onMounted(reload)
</script>
