// 领域规则临时验证脚本（开发用）：用最小 localStorage/window 桩驱动纯前端数据层。
const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  },
}

import { saveRows } from '../src/data/local-store.ts'
import { SEED_ROWS } from '../src/data/seed.ts'
import * as rt from '../src/data/relay-test.ts'

saveRows('relaytest', SEED_ROWS.relaytest)

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name) }
}

// 1. 列表读取与明细同源
const rows = rt.listRelayRows()
check('种子记录数=5', rows.length === 5)
check('旧数据补齐所属班组', rows.every((r) => typeof r['所属班组'] === 'string' && r['所属班组']))

// 2. 跨班组改动作值被打回
const r2 = rt.getRelayRow(2) // 继电保护一班
const cross = rt.saveRelayValues(2, { actionValue: '9.99 A', returnValue: '8.88 A' }, '外班人', '继电保护二班')
check('跨班组修改被打回', !cross.ok && cross.message.includes('跨班组'))
check('跨班组数值未变', rt.getRelayRow(2)['动作值'] === r2['动作值'])

// 3. 本班组修改成功且留经办人
const own = rt.saveRelayValues(2, { actionValue: '3.90 A', returnValue: '3.50 A' }, '王晓峰', '继电保护一班')
check('归属班组修改放行', own.ok)
const r2b = rt.getRelayRow(2)
check('动作值已更新', r2b['动作值'] === '3.90 A')
check('返回值同一数据源同步', r2b['返回值'] === '3.50 A')
const editLog = rt.relayLogs(r2b).find((l) => l.action.includes('修改'))
check('改动记录有经办人', !!editLog && editLog.operator === '王晓峰' && editLog.team === '继电保护一班')

// 4. 无经办人打回
const noop = rt.saveRelayValues(2, { actionValue: '1.00 A', returnValue: '0.90 A' }, '  ', '继电保护一班')
check('经办人缺失打回', !noop.ok)

// 5. 重复提交只算一遍
const s1 = rt.submitRelayVerify(2, '王晓峰', '继电保护一班')
check('重复提交（已是校验中）打回', !s1.ok && s1.message.includes('重复提交'))

// 6. 跨班组判定打回
const jcross = rt.judgeRelay(2, true, '外人', '继电保护二班')
check('跨班组判定打回', !jcross.ok)

// 7. 不合格记录锁定：id=4 已是不合格，任何改动（含本班组）拒绝
const lockEdit = rt.saveRelayValues(4, { actionValue: '1.00 A', returnValue: '0.90 A' }, '陈志远', '继电保护二班')
check('不合格记录不可改数值', !lockEdit.ok && lockEdit.message.includes('锁定'))
const lockSubmit = rt.submitRelayVerify(4, '陈志远', '继电保护二班')
check('不合格记录不可再提交', !lockSubmit.ok)
const lockJudge = rt.judgeRelay(4, true, '陈志远', '继电保护二班')
check('不合格记录不能直接判合格翻案', !lockJudge.ok)

// 8. 不合格驱动待复核
const items = rt.listReviewItems()
check('不合格结论进入待复核清单', items.some((i) => Number(i.relay.id) === 4 && i.state === '待复核'))
check('待复核数量=1', rt.pendingReviewCount() === 1)

// 9. 复核登记
const rv = rt.saveReview(4, '检查端子排后复测正常', '孙复核', '检修试验班')
check('复核意见登记成功', rv.ok)
check('复核后不再待复核', rt.pendingReviewCount() === 0)

// 10. 本班组重做校验：另起一轮，老记录保持锁定
const redo = rt.redoRelayVerify(4, '陈志远', '继电保护二班')
check('重做校验创建新轮次', redo.ok && redo.recordId && redo.recordId !== 4)
const fresh = rt.getRelayRow(redo.recordId)
check('新轮次状态=待校验 且 round=2', fresh.status === '待校验' && fresh.round === 2)
check('新轮次归属同班组', fresh['所属班组'] === '继电保护二班')
check('新轮次默认不可直接判合格(未提交)', !rt.judgeRelay(redo.recordId, true, '陈志远', '继电保护二班').ok)
check('原记录仍锁定', rt.getRelayRow(4).status === '校验不合格')

// 11. 新轮次完整流程：改值→提交(去重)→判合格→翻案闭环
rt.saveRelayValues(redo.recordId, { actionValue: '6.50 A', returnValue: '6.00 A' }, '陈志远', '继电保护二班')
const sub = rt.submitRelayVerify(redo.recordId, '陈志远', '继电保护二班')
check('新轮次提交成功', sub.ok)
const dup = rt.submitRelayVerify(redo.recordId, '陈志远', '继电保护二班')
check('新轮次重复提交只算一遍', !dup.ok)
const passJudge = rt.judgeRelay(redo.recordId, true, '陈志远', '继电保护二班')
check('新轮次判合格成功', passJudge.ok)
const after = rt.listReviewItems().find((i) => Number(i.relay.id) === 4)
check('老不合格项标记已闭环', !!after && after.state === '已闭环')

// 12. 统计按校验编号取最新一轮，不重复计数
const counts = rt.relayStatusCounts()
check('合格数随翻案更新（最新轮）', counts['校验合格'] >= 2)
const code4 = rt.latestRoundRows().filter((r) => r['校验编号'] === 'RELA-1102')
check('同编号统计只取最新一轮', code4.length === 1 && code4[0].round === 2)

// 13. 导出册子动作值列与明细一致
const { content } = rt.buildRelayBook()
const header = content.split('\n')[0]
check('导出含动作值列且位置正确', header.split(',').indexOf('动作值') === 4)
const line4 = content.split('\n').find((l) => l.startsWith('RELA-1102,') && l.includes('第2轮'))
check('导出行动作值与明细一致', line4 && line4.split(',')[4] === '6.50 A')
// CSV 转义：临时给返回值塞逗号验证不串列
rt.saveRelayValues(2, { actionValue: '3,90 A', returnValue: '3.50 A' }, '王晓峰', '继电保护一班')
const esc = rt.buildRelayBook().content.split('\n').find((l) => l.startsWith('RELA-2202,'))
check('含逗号单元格被引号包裹不串列', esc && esc.split('","').length >= 1 && esc.includes('"3,90 A"'))

// 14. 重新进入不换一份：数据已持久化在 localStorage 桩中，再读一次一致
check('重新读取数据保持一致（重新进入不换样）', rt.listRelayRows().length === 6)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
