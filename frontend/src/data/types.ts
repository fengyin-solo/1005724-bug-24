/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryValue = string | number | boolean | EntryChangeLog[]

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
}

/** 改动留痕：动作值/返回值的每一次修改都记一条，经办人不得为空。 */
export type EntryChangeLog = {
  time: string
  operator: string
  team: string
  field: string
  before: string
  after: string
}

/** 保护校验记录：在通用行结构上叠加归属、轮次与留痕字段。 */
export type RelayTestRow = EntryRow & {
  校验编号: string
  装置名称: string
  校验项目: string
  动作值: string
  返回值: string
  校验人: string
  校验日期: string
  校验状态: string
  所属班组: string
  经办人: string
  提交时间: string
  校验轮次: number
  变更记录: EntryChangeLog[]
}

/** 由「校验不合格」驱动到二次回路检查的待复核条目。 */
export type SecondaryReviewRow = EntryRow & {
  检查编号: string
  所属间隔: string
  回路类别: string
  端子排编号: string
  绝缘电阻: string
  检查人: string
  检查日期: string
  回路状态: string
  来源类型: string
  关联校验编号: string
  装置名称: string
  所属班组: string
  判定经办人: string
  复核状态: string
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
