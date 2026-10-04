/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 动作值/返回值等关键字段的每次改动都要留痕，经办人必填。 */
export type ChangeLog = {
  at: string
  operator: string
  team: string
  action: string
  detail?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 变更记录等结构化字段允许挂在行上，兼容历史数据。
  [field: string]: string | number | boolean | ChangeLog[] | null
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
