import { listRows, readJson, saveRows, writeJson } from './local-store'
import type { ChangeLog, EntryRow } from './types'

/**
 * 保护校验领域规则（动作值/返回值的唯一事实来源都在这里）：
 * 1. 校验记录归属哪个班组，动作值与返回值就只有该班组能改，跨班组一律打回；
 * 2. 判定过不合格的记录整条锁成只读，翻案只能由本班组重做校验（另起一轮）；
 * 3. 列表只做查看，改动只允许在明细面板按上面两条权限进行；
 * 4. 动作值/返回值的每一次改动都写入变更记录，经办人必填；
 * 5. 不合格结论驱动二次回路检查的待复核清单；
 * 6. 同一条记录同一轮重复提交校验只算一遍。
 */

export const RELAY_KEY = 'relaytest'
export const RELAY_TEAMS = ['继电保护一班', '继电保护二班', '检修试验班'] as const
export type RelayTeam = (typeof RELAY_TEAMS)[number]

export const RELAY_STATUSES = ['待校验', '校验中', '校验合格', '校验不合格'] as const
const LOCKED_STATUS = '校验不合格'

export type RelayValues = {
  actionValue: string
  returnValue: string
}

export type ReviewRecord = {
  id: number
  relayId: number
  opinion: string
  operator: string
  team: string
  at: string
}

export type ReviewItem = {
  review: ReviewRecord | null
  relay: EntryRow
  /** 待复核：最新一轮仍是不合格且没人复核；已复核：留过意见；已闭环：后续轮次已判合格。 */
  state: '待复核' | '已复核' | '已闭环'
}

const REVIEW_STORAGE_KEY = 'substation-protection:relay-reviews'
let normalized = false

function now(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function toLog(value: unknown): ChangeLog[] {
  return Array.isArray(value)
    ? (value as ChangeLog[]).filter((item) => item && typeof item.at === 'string')
    : []
}

/** 兼容既有校验记录：老数据没有班组、轮次、变更记录时补齐，不换一份数据。 */
export function ensureRelayData(): EntryRow[] {
  const rows = listRows(RELAY_KEY).map((row, index) => {
    const legacySample = String(row['动作值'] ?? '').includes('样例')
    const team =
      typeof row['所属班组'] === 'string' && row['所属班组']
        ? String(row['所属班组'])
        : RELAY_TEAMS[index % RELAY_TEAMS.length]
    const status = RELAY_STATUSES.includes(String(row.status) as (typeof RELAY_STATUSES)[number])
      ? String(row.status)
      : '待校验'
    const next: EntryRow = {
      ...row,
      status,
      pending: status === '待校验' || status === '校验中',
      abnormal: status === LOCKED_STATUS,
      '所属班组': team,
      '动作值': legacySample ? '5.00 A' : String(row['动作值'] ?? ''),
      '返回值': legacySample ? '4.50 A' : String(row['返回值'] ?? ''),
      '校验状态': status,
      round: typeof row.round === 'number' ? row.round : 1,
      revisionOf: typeof row.revisionOf === 'number' ? row.revisionOf : null,
      logs: toLog(row.logs),
    }
    return next
  })
  if (!normalized) {
    saveRows(RELAY_KEY, rows)
    normalized = true
  }
  return rows
}

function persist(rows: EntryRow[]): void {
  saveRows(RELAY_KEY, rows)
}

function sorted(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const code = String(a['校验编号'] ?? '').localeCompare(String(b['校验编号'] ?? ''), 'zh')
    if (code !== 0) return code
    return Number(a.round) - Number(b.round)
  })
}

/** 名册与明细面板共用这一份读取，返回值不会出现两处不一致。 */
export function listRelayRows(): EntryRow[] {
  return sorted(ensureRelayData())
}

export function getRelayRow(id: number): EntryRow | undefined {
  return ensureRelayData().find((row) => Number(row.id) === Number(id))
}

export function isLocked(row: EntryRow): boolean {
  return String(row.status) === LOCKED_STATUS
}

/** 动作值/返回值只对归属班组开放，且结论已固化的记录不可再改。 */
export function canEditValues(row: EntryRow, team: string): boolean {
  return String(row['所属班组']) === team && !isLocked(row) && String(row.status) !== '校验合格'
}

export function lockedReason(row: EntryRow, team: string): string {
  if (String(row['所属班组']) !== team) {
    return `跨班组改动一律打回：该记录归属「${row['所属班组']}」，当前账号属「${team}」`
  }
  if (isLocked(row)) {
    return '该记录已判定不合格，整条锁定为只读；要翻案须由本班组重做校验'
  }
  if (String(row.status) === '校验合格') {
    return '该记录已判定合格，动作值与返回值随结论固化，不能再改'
  }
  return ''
}

function appendLog(row: EntryRow, log: Omit<ChangeLog, 'at'>): EntryRow {
  const logs = toLog(row.logs)
  logs.push({ at: now(), ...log })
  return { ...row, logs }
}

function requireOperator(operator: string, team: string): string | null {
  if (!operator.trim()) return '经办人缺失，改动不予记录，请先在右上角登记当班账号'
  if (!RELAY_TEAMS.includes(team as RelayTeam)) return '当前账号没有归属班组，不能改动校验记录'
  return null
}

export type RelayActionResult = {
  ok: boolean
  message: string
  recordId?: number
}

/** 修改动作值/返回值：归属班组 + 非锁定状态 + 经办人留痕，缺一不可。 */
export function saveRelayValues(
  id: number,
  values: RelayValues,
  operator: string,
  team: string,
): RelayActionResult {
  const operatorError = requireOperator(operator, team)
  if (operatorError) return { ok: false, message: operatorError }

  const rows = ensureRelayData()
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) return { ok: false, message: '没有找到这条校验记录' }
  const row = rows[index]

  const reason = lockedReason(row, team)
  if (reason) return { ok: false, message: reason }

  const actionValue = values.actionValue.trim()
  const returnValue = values.returnValue.trim()
  if (!actionValue || !returnValue) {
    return { ok: false, message: '动作值与返回值都不能为空' }
  }

  const changes: string[] = []
  if (actionValue !== String(row['动作值'] ?? '')) {
    changes.push(`动作值：${row['动作值'] || '空'} → ${actionValue}`)
  }
  if (returnValue !== String(row['返回值'] ?? '')) {
    changes.push(`返回值：${row['返回值'] || '空'} → ${returnValue}`)
  }
  if (changes.length === 0) {
    return { ok: true, message: '数值没有变化', recordId: Number(row.id) }
  }

  let next = appendLog(row, {
    operator: operator.trim(),
    team,
    action: '修改动作值/返回值',
    detail: changes.join('；'),
  })
  next = { ...next, '动作值': actionValue, '返回值': returnValue }
  rows[index] = next
  persist(rows)
  return { ok: true, message: `改动已记录（经办人：${operator.trim()}）`, recordId: Number(row.id) }
}

/** 提交校验：同一轮重复提交只算一遍。 */
export function submitRelayVerify(id: number, operator: string, team: string): RelayActionResult {
  const operatorError = requireOperator(operator, team)
  if (operatorError) return { ok: false, message: operatorError }

  const rows = ensureRelayData()
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) return { ok: false, message: '没有找到这条校验记录' }
  const row = rows[index]

  if (isLocked(row)) {
    return { ok: false, message: lockedReason(row, team) || '不合格记录已锁定' }
  }
  if (String(row['所属班组']) !== team) {
    return { ok: false, message: lockedReason(row, team) }
  }
  if (String(row.status) === '校验中') {
    return { ok: false, message: '该记录本轮已经提交过校验，重复提交只算一遍' }
  }
  if (String(row.status) === '校验合格') {
    return { ok: false, message: '该记录已判定合格，无需重复提交' }
  }

  let next = appendLog(row, { operator: operator.trim(), team, action: '提交校验' })
  next = { ...next, status: '校验中', pending: true, abnormal: false, '校验状态': '校验中' }
  rows[index] = next
  persist(rows)
  return { ok: true, message: '已提交校验，等待判定', recordId: Number(row.id) }
}

/** 判定合格/不合格：仅归属班组，且只能在校验中判定。 */
export function judgeRelay(
  id: number,
  pass: boolean,
  operator: string,
  team: string,
): RelayActionResult {
  const operatorError = requireOperator(operator, team)
  if (operatorError) return { ok: false, message: operatorError }

  const rows = ensureRelayData()
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) return { ok: false, message: '没有找到这条校验记录' }
  const row = rows[index]

  if (String(row['所属班组']) !== team) {
    return { ok: false, message: lockedReason(row, team) }
  }
  if (isLocked(row)) {
    return { ok: false, message: lockedReason(row, team) }
  }
  if (String(row.status) !== '校验中') {
    return { ok: false, message: '只有已提交、校验中的记录才能判定' }
  }

  const target = pass ? '校验合格' : LOCKED_STATUS
  let next = appendLog(row, {
    operator: operator.trim(),
    team,
    action: pass ? '判定合格' : '判定不合格',
    detail: `动作值 ${row['动作值']} / 返回值 ${row['返回值']}`,
  })
  next = {
    ...next,
    status: target,
    pending: false,
    abnormal: !pass,
    '校验状态': target,
  }
  rows[index] = next
  persist(rows)
  return {
    ok: true,
    message: pass
      ? `已判定合格（经办人：${operator.trim()}）`
      : `已判定不合格，记录整条锁定，并进入二次回路待复核清单（经办人：${operator.trim()}）`,
    recordId: Number(row.id),
  }
}

/** 重做校验：仅本班组，针对不合格记录另起一轮，老记录保持锁定留档。 */
export function redoRelayVerify(id: number, operator: string, team: string): RelayActionResult {
  const operatorError = requireOperator(operator, team)
  if (operatorError) return { ok: false, message: operatorError }

  const rows = ensureRelayData()
  const source = rows.find((row) => Number(row.id) === Number(id))
  if (!source) return { ok: false, message: '没有找到这条校验记录' }
  if (String(source['所属班组']) !== team) {
    return { ok: false, message: lockedReason(source, team) }
  }
  if (!isLocked(source)) {
    return { ok: false, message: '只有判定过不合格的记录才需要重做校验' }
  }

  const nextRound = Number(source.round) + 1
  const newId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = {
    ...source,
    id: newId,
    status: '待校验',
    pending: true,
    abnormal: false,
    '校验状态': '待校验',
    '校验人': operator.trim(),
    round: nextRound,
    revisionOf: Number(source.id),
    logs: [],
  }
  const withLog = appendLog(created, {
    operator: operator.trim(),
    team,
    action: `重做校验（第${nextRound}轮）`,
    detail: `沿用不合格记录 ${source['校验编号']} 第${source.round}轮的设备信息，重新录取动作值/返回值`,
  })
  persist([...rows, withLog])
  return { ok: true, message: `已另起第 ${nextRound} 轮校验，请重新录取数值并提交`, recordId: newId }
}

/** 同一校验编号只取轮次最大的一条参与统计，重做不会重复计数。 */
export function latestRoundRows(): EntryRow[] {
  const latest = new Map<string, EntryRow>()
  for (const row of listRelayRows()) {
    const code = String(row['校验编号'] ?? row.id)
    const current = latest.get(code)
    if (!current || Number(row.round) > Number(current.round)) {
      latest.set(code, row)
    }
  }
  return [...latest.values()]
}

export function relayStatusCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const status of RELAY_STATUSES) counts[status] = 0
  for (const row of latestRoundRows()) {
    counts[String(row.status)] = (counts[String(row.status)] ?? 0) + 1
  }
  return counts
}

export function relayLogs(row: EntryRow): ChangeLog[] {
  return toLog(row.logs)
}

// ---- 二次回路待复核清单：由不合格结论驱动 ------------------------------------

function readReviews(): ReviewRecord[] {
  const data = readJson<ReviewRecord[]>(REVIEW_STORAGE_KEY, [])
  return Array.isArray(data) ? data : []
}

/** 二次回路检查页面读到的待复核清单：最新一轮不合格的记录自动进入。 */
export function listReviewItems(): ReviewItem[] {
  const rows = listRelayRows()
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const latest = latestRoundRows()
  const reviews = readReviews()
  const items: ReviewItem[] = []

  for (const row of latest.filter((item) => isLocked(item))) {
    const review = reviews.find((item) => Number(item.relayId) === Number(row.id)) ?? null
    items.push({ review, relay: row, state: review ? '已复核' : '待复核' })
  }
  // 已复核过、但该编号后续轮次翻案合格的，保留在清单里标记闭环。
  for (const review of reviews) {
    const relay = byId.get(Number(review.relayId))
    if (!relay) continue
    const code = String(relay['校验编号'] ?? relay.id)
    const current = latest.find((item) => String(item['校验编号'] ?? item.id) === code)
    if (current && Number(current.id) !== Number(relay.id)) {
      if (!items.some((item) => item.review?.id === review.id)) {
        items.push({ review, relay, state: '已闭环' })
      }
    }
  }
  return items
}

export function pendingReviewCount(): number {
  return listReviewItems().filter((item) => item.state === '待复核').length
}

export function saveReview(
  relayId: number,
  opinion: string,
  operator: string,
  team: string,
): RelayActionResult {
  if (!operator.trim()) return { ok: false, message: '复核人缺失，不能提交复核意见' }
  const text = opinion.trim()
  if (!text) return { ok: false, message: '请填写复核意见' }

  const target = getRelayRow(relayId)
  if (!target) return { ok: false, message: '没有找到对应的校验记录' }
  if (!isLocked(target)) {
    return { ok: false, message: '该记录已不是不合格结论，无需复核' }
  }

  const reviews = readReviews()
  const existing = reviews.find((item) => Number(item.relayId) === Number(relayId))
  if (existing) {
    existing.opinion = text
    existing.operator = operator.trim()
    existing.team = team
    existing.at = now()
  } else {
    const id = reviews.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
    reviews.push({ id, relayId: Number(relayId), opinion: text, operator: operator.trim(), team, at: now() })
  }
  writeJson(REVIEW_STORAGE_KEY, reviews)
  return { ok: true, message: `复核意见已登记（复核人：${operator.trim()}）` }
}

// ---- 导出册子：动作值列与明细同源，逐列对齐并做 CSV 转义 ----------------------

const EXPORT_COLUMNS = [
  '校验编号',
  '装置名称',
  '校验项目',
  '所属班组',
  '动作值',
  '返回值',
  '校验人',
  '校验日期',
  '当前状态',
  '轮次',
]

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildRelayBook(): { filename: string; content: string } {
  const lines = [EXPORT_COLUMNS.join(',')]
  for (const row of listRelayRows()) {
    lines.push(
      [
        row['校验编号'],
        row['装置名称'],
        row['校验项目'],
        row['所属班组'],
        row['动作值'],
        row['返回值'],
        row['校验人'],
        row['校验日期'],
        row.status,
        `第${row.round}轮`,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '保护校验清册.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadRelayBook(): void {
  const { filename, content } = buildRelayBook()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
