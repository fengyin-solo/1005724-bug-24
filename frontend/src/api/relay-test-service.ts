import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryChangeLog,
  EntryRow,
  RelayTestRow,
  SecondaryReviewRow,
} from '@/data/types'

/**
 * 保护校验领域规则（集中在数据层，页面只读/只转发）：
 * 1. 校验记录按「所属班组」归属，动作值与返回值只有归属班组能改，跨班组一律打回；
 * 2. 判过「校验不合格」的整条记录锁成只读，只有本班组「重做校验」后才能再次流转；
 * 3. 列表只读，任何写入都只动单一数据源 localStorage，不另存副本，重新进入还是同一份；
 * 4. 动作值/返回值在名册（列表）与明细面板读的是同一行，导出列也与明细逐格一致；
 * 5. 判不合格会向二次回路检查写入一条「待复核」清单（同一条只生成一份，可重入）；
 * 6. 同一条记录重复提交校验只算一遍：已在「校验中」再次提交直接幂等返回。
 */

const RELAY_KEY = 'relaytest'
const SECONDARY_KEY = 'secondarycircuit'

export const FAIL_STATUS = '校验不合格'
const REVIEW_STATUS = '待复核'
const VERIFYING_STATUS = '校验中'
const PASS_STATUS = '校验合格'
const WAIT_STATUS = '待校验'

const TEAM_FIELD = '所属班组'
const OPERATOR_FIELD = '经办人'
const SUBMIT_TIME_FIELD = '提交时间'
const ROUND_FIELD = '校验轮次'
const CHANGE_LOG_FIELD = '变更记录'

export type OperatorContext = {
  team: string
  operator: string
}

export type RelayDraft = {
  校验编号: string
  装置名称: string
  校验项目: string
  动作值?: string
  返回值?: string
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

/** 兼容既有校验记录：旧数据没有归属班组/经办人/留痕字段，读取时补齐默认值并落回同一数据源。 */
function ensureRelayShape(row: EntryRow): RelayTestRow {
  const normalized: RelayTestRow = {
    ...row,
    校验编号: asText(row['校验编号']),
    装置名称: asText(row['装置名称']),
    校验项目: asText(row['校验项目']),
    动作值: asText(row['动作值']),
    返回值: asText(row['返回值']),
    校验人: asText(row['校验人']),
    校验日期: asText(row['校验日期']),
    校验状态: asText(row['校验状态']),
    所属班组: asText(row[TEAM_FIELD]) || '继电保护一班',
    经办人: asText(row[OPERATOR_FIELD]),
    提交时间: asText(row[SUBMIT_TIME_FIELD]),
    校验轮次: Number(row[ROUND_FIELD] ?? 1) || 1,
    变更记录: Array.isArray(row[CHANGE_LOG_FIELD])
      ? (row[CHANGE_LOG_FIELD] as EntryChangeLog[])
      : [],
  }
  return normalized
}

/** 读取与列表、明细面板、导出共用的同一份校验记录。 */
export function loadRelayRows(): RelayTestRow[] {
  const raw = listRows(RELAY_KEY)
  let changed = false
  const rows = raw.map((row) => {
    // 仅当旧记录缺少归属/轮次字段时才算需要迁移，避免每次读取都无谓落盘。
    if (asText(row[TEAM_FIELD]) === '' || row[ROUND_FIELD] === undefined) {
      changed = true
    }
    return ensureRelayShape(row)
  })
  if (changed) {
    saveRows(RELAY_KEY, rows)
  }
  return rows
}

export function getRelayRow(id: number): RelayTestRow | undefined {
  return loadRelayRows().find((row) => Number(row.id) === id)
}

function persistRelayRows(rows: RelayTestRow[]): void {
  saveRows(RELAY_KEY, rows)
}

function isOwner(row: RelayTestRow, ctx: OperatorContext): boolean {
  return asText(row[TEAM_FIELD]) === ctx.team
}

/** 判过不合格的整条锁成只读（重做校验回到「校验中」后才解锁）。 */
export function isLocked(row: RelayTestRow): boolean {
  return asText(row.status) === FAIL_STATUS
}

function deny(message: string): ActionResult {
  return { ok: false, message }
}

function appendChangeLog(row: RelayTestRow, log: EntryChangeLog): void {
  row[CHANGE_LOG_FIELD] = [...row[CHANGE_LOG_FIELD], log]
}

/** 登记新的校验记录：归属当前班组，列表之后只读，不能再换一份。 */
export function createRelayEntry(draft: RelayDraft, ctx: OperatorContext): ActionResult {
  const code = draft['校验编号'].trim()
  if (!code) {
    return deny('校验编号不能为空')
  }
  const rows = loadRelayRows()
  if (rows.some((row) => row['校验编号'] === code)) {
    return deny(`校验编号 ${code} 已存在，不能重复登记`)
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const entry: RelayTestRow = {
    id,
    status: WAIT_STATUS,
    pending: true,
    abnormal: false,
    校验编号: code,
    装置名称: draft['装置名称'].trim(),
    校验项目: draft['校验项目'].trim(),
    动作值: draft['动作值']?.trim() ?? '',
    返回值: draft['返回值']?.trim() ?? '',
    校验人: ctx.operator,
    校验日期: today,
    校验状态: WAIT_STATUS,
    所属班组: ctx.team,
    经办人: '',
    提交时间: '',
    校验轮次: 1,
    变更记录: [],
  }
  persistRelayRows([...rows, entry])
  return { ok: true, message: `校验记录 ${code} 已登记，归属${ctx.team}` }
}

/**
 * 修改动作值/返回值：
 * - 只有归属班组能改，跨班组一律打回；
 * - 判不合格锁定后整条只读，不允许直接把数值改成合格；
 * - 每次改动都留经办人；值未变化不写记录。
 */
export function updateRelayValues(
  id: number,
  patch: { 动作值?: string; 返回值?: string },
  ctx: OperatorContext,
): ActionResult {
  const rows = loadRelayRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return deny(`没有找到编号为 ${id} 的校验记录`)
  }
  const current = rows[index]
  if (!isOwner(current, ctx)) {
    return deny(`校验记录 ${current['校验编号']} 归属${current[TEAM_FIELD]}，${ctx.team}无权修改动作值与返回值`)
  }
  if (isLocked(current)) {
    return deny(`校验记录 ${current['校验编号']} 已判不合格并锁定，需由本班组重做校验后才能修改`)
  }
  const updated: RelayTestRow = { ...current, 变更记录: [...current['变更记录']] }
  const fields = ['动作值', '返回值'] as const
  let touched = false
  for (const field of fields) {
    if (!(field in patch)) {
      continue
    }
    const before = asText(current[field])
    const after = (patch[field] ?? '').trim()
    if (after === before) {
      continue
    }
    updated[field] = after
    appendChangeLog(updated, {
      time: nowText(),
      operator: ctx.operator,
      team: ctx.team,
      field,
      before,
      after,
    })
    touched = true
  }
  if (!touched) {
    return deny('动作值与返回值均未变化，未产生改动')
  }
  rows[index] = updated
  persistRelayRows(rows)
  return { ok: true, message: `校验记录 ${current['校验编号']} 的数值已更新，经办人：${ctx.operator}` }
}

function listSecondary(): SecondaryReviewRow[] {
  return listRows(SECONDARY_KEY) as unknown as SecondaryReviewRow[]
}

function persistSecondary(rows: SecondaryReviewRow[]): void {
  saveRows(SECONDARY_KEY, rows as unknown as EntryRow[])
}

function reviewCodeOf(relayCode: string): string {
  return `RV-${relayCode}`
}

/**
 * 判不合格驱动二次回路检查待复核清单：
 * 同一条校验记录只生成一份待复核条目（按来源校验编号幂等），重新判定/重入不重复。
 */
export function ensureSecondaryReview(row: RelayTestRow): void {
  const rows = listSecondary()
  const reviewCode = reviewCodeOf(row['校验编号'])
  if (
    rows.some(
      (item) =>
        asText(item['来源类型']) === '保护校验判不合格' &&
        asText(item['关联校验编号']) === row['校验编号'],
    )
  ) {
    return
  }
  const id = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const entry: SecondaryReviewRow = {
    id,
    status: REVIEW_STATUS,
    pending: true,
    abnormal: true,
    检查编号: reviewCode,
    所属间隔: asText(row['装置名称']),
    回路类别: '保护校验不合格复核',
    端子排编号: reviewCode,
    绝缘电阻: '',
    检查人: '',
    检查日期: asText(row['校验日期']),
    回路状态: REVIEW_STATUS,
    来源类型: '保护校验判不合格',
    关联校验编号: row['校验编号'],
    装置名称: asText(row['装置名称']),
    所属班组: asText(row[TEAM_FIELD]),
    判定经办人: asText(row[OPERATOR_FIELD]),
    复核状态: REVIEW_STATUS,
  }
  persistSecondary([...rows, entry])
}

/** 翻案为合格时，把同一条校验记录驱动出的待复核条目闭环（待复核 -> 已闭环），只去重一份。 */
function closeSecondaryReview(row: RelayTestRow): void {
  const rows = listSecondary()
  let changed = false
  const next = rows.map((item) => {
    if (
      asText(item['来源类型']) === '保护校验判不合格' &&
      asText(item['关联校验编号']) === row['校验编号'] &&
      asText(item['复核状态']) === REVIEW_STATUS
    ) {
      changed = true
      return { ...item, status: '检查合格', pending: false, abnormal: false, 复核状态: '已闭环' }
    }
    return item
  })
  if (changed) {
    persistSecondary(next)
  }
}

/**
 * 校验流转（提交校验 / 判定合格 / 标记不合格 / 重做校验）。
 * 全部按归属班组设限；终态「校验不合格」锁定，只有重做校验能解锁；重复提交只算一遍。
 */
export function transitRelay(id: number, action: string, ctx: OperatorContext): ActionResult {
  const targetMap: Record<string, string> = {
    提交校验: VERIFYING_STATUS,
    判定合格: PASS_STATUS,
    标记不合格: FAIL_STATUS,
    重做校验: VERIFYING_STATUS,
  }
  const target = targetMap[action]
  if (!target) {
    return deny(`校验记录没有登记「${action}」这个动作`)
  }
  const rows = loadRelayRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return deny(`没有找到编号为 ${id} 的校验记录`)
  }
  const current = rows[index]
  if (!isOwner(current, ctx)) {
    return deny(`校验记录 ${current['校验编号']} 归属${current[TEAM_FIELD]}，${ctx.team}不能${action}`)
  }
  const status = asText(current.status)

  // 幂等：同一条记录重复提交校验只算一遍，不新增轮次、不重复留痕。
  if (action === '提交校验' && status === VERIFYING_STATUS) {
    return { ok: true, message: `校验记录 ${current['校验编号']} 已在校验中，重复提交只算一遍` }
  }
  // 只有「待校验」可以提交校验；校验中已在上面幂等处理，其余状态不允许再提交。
  if (action === '提交校验' && status !== WAIT_STATUS) {
    return deny(`校验记录 ${current['校验编号']} 当前为「${status}」，不能再提交校验`)
  }
  if (action === '重做校验' && status !== FAIL_STATUS) {
    return deny(`校验记录 ${current['校验编号']} 当前为「${status}」，只有判过不合格的记录需要重做校验`)
  }
  if ((action === '判定合格' || action === '标记不合格') && status !== VERIFYING_STATUS) {
    return deny(`校验记录 ${current['校验编号']} 当前为「${status}」，需先提交/重做校验进入校验中才能判定`)
  }

  const updated: RelayTestRow = {
    ...current,
    变更记录: [...current['变更记录']],
  }
  updated.status = target
  updated['校验状态'] = target
  updated.pending = target !== PASS_STATUS && target !== FAIL_STATUS
  updated.abnormal = target === FAIL_STATUS

  if (action === '提交校验' || action === '重做校验') {
    if (action === '重做校验') {
      updated['校验轮次'] = current['校验轮次'] + 1
    }
    updated[OPERATOR_FIELD] = ctx.operator
    updated[SUBMIT_TIME_FIELD] = nowText()
    appendChangeLog(updated, {
      time: nowText(),
      operator: ctx.operator,
      team: ctx.team,
      field: '状态',
      before: status,
      after: `${target}（第${updated['校验轮次']}轮）`,
    })
  } else {
    // 判定合格 / 不合格同样必须留经办人，不留空。
    updated[OPERATOR_FIELD] = ctx.operator
    appendChangeLog(updated, {
      time: nowText(),
      operator: ctx.operator,
      team: ctx.team,
      field: '结论',
      before: status,
      after: target,
    })
  }

  rows[index] = updated
  persistRelayRows(rows)

  if (action === '标记不合格') {
    ensureSecondaryReview(updated)
  }
  if (action === '判定合格') {
    // 翻案为合格（或直接合格）：闭环此前由该记录驱动出的待复核条目，无则空操作。
    closeSecondaryReview(updated)
  }

  const suffix = action === '重做校验' ? `，已进入第${updated['校验轮次']}轮校验` : ''
  return { ok: true, message: `校验记录 ${current['校验编号']} 已${action}，当前状态「${target}」${suffix}` }
}

/** 二次回路检查的待复核清单：只呈现由保护校验不合格驱动、尚未闭环的那一份。 */
export function listPendingReviews(): SecondaryReviewRow[] {
  return listSecondary().filter(
    (row) =>
      asText(row['来源类型']) === '保护校验判不合格' &&
      asText(row['复核状态']) === REVIEW_STATUS,
  )
}

/**
 * 受理复核：待复核条目进入检查中（由二次回路班组接手），同时把复核状态标记为「复核中」，
 * 使它从待复核清单移除；同一条重复受理只认当前状态，不产生新条目。
 */
export function acceptSecondaryReview(id: number): ActionResult {
  const rows = listSecondary()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return deny(`没有找到编号为 ${id} 的待复核条目`)
  }
  const current = rows[index]
  if (asText(current['复核状态']) !== REVIEW_STATUS) {
    return deny(`复核条目 ${current['检查编号']} 已受理，无需重复受理`)
  }
  rows[index] = {
    ...current,
    status: '检查中',
    pending: true,
    abnormal: false,
    回路状态: '检查中',
    复核状态: '复核中',
  }
  persistSecondary(rows)
  return { ok: true, message: `复核条目 ${current['检查编号']} 已受理，进入二次回路检查` }
}

function csvCell(value: unknown): string {
  const text = asText(value)
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * 导出保护校验册子：动作值、返回值列与明细面板逐格同源一致，不丢列、不错位。
 * 显式按固定列顺序输出，避免旧字段口径变动导致整列丢失。
 */
export function exportRelayBook(): { filename: string; content: string } {
  const header = [
    '编号',
    '校验编号',
    '装置名称',
    '校验项目',
    '动作值',
    '返回值',
    '所属班组',
    '经办人',
    '校验轮次',
    '校验日期',
    '校验状态',
  ]
  const lines = [header.map(csvCell).join(',')]
  for (const row of loadRelayRows()) {
    lines.push(
      [
        row.id,
        row['校验编号'],
        row['装置名称'],
        row['校验项目'],
        row['动作值'],
        row['返回值'],
        row[TEAM_FIELD],
        row[OPERATOR_FIELD],
        row['校验轮次'],
        row['校验日期'],
        row.status,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '保护校验-清单.csv', content: `﻿${lines.join('\n')}` }
}
