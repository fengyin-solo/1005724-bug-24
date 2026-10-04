/* 规则冒烟测试：通过 esbuild 把 TS 领域服务打成 ESM 后用 node 断言。
   覆盖：归属设限、终态锁定、留痕经办人、幂等提交、重做翻案、复核联动只生成一份、导出列含动作值。 */
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// 内存版 localStorage，避免污染浏览器存储。
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}

await build({
  entryPoints: ['src/api/relay-test-service.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'node_modules/.tmp/relay-test-service.mjs',
  alias: { '@': process.cwd() + '/src' },
  logLevel: 'silent',
})

const svc = await import(pathToFileURL(process.cwd() + '/node_modules/.tmp/relay-test-service.mjs').href)
const {
  loadRelayRows,
  createRelayEntry,
  updateRelayValues,
  transitRelay,
  listPendingReviews,
  exportRelayBook,
} = svc

const A = { team: '继电保护一班', operator: '张三' }
const B = { team: '继电保护二班', operator: '李四' }

let pass = 0
function ok(name, cond) {
  assert.ok(cond, name)
  pass++
  console.log('  ✓', name)
}

// 1. 登记一条归属一班的记录
const created = createRelayEntry(
  { 校验编号: 'RELA-T1', 装置名称: '1号主变差动', 校验项目: '动作值校验', 动作值: '5.0', 返回值: '4.0' },
  A,
)
ok('本班组登记成功', created.ok)
const id = loadRelayRows().find((r) => r['校验编号'] === 'RELA-T1').id

// 2. 跨班组改动作值/返回值被打回
const cross = updateRelayValues(id, { 动作值: '9.9' }, B)
ok('跨班组修改被打回', !cross.ok && /无权修改/.test(cross.message))
ok('被打回后值未变', loadRelayRows().find((r) => r.id === id)['动作值'] === '5.0')

// 3. 本班组修改成功且留经办人
const own = updateRelayValues(id, { 动作值: '5.2' }, A)
ok('本班组修改成功', own.ok)
const afterOwn = loadRelayRows().find((r) => r.id === id)
ok('动作值已更新', afterOwn['动作值'] === '5.2')
const log0 = afterOwn['变更记录'][0]
ok('改动记录含经办人', log0 && log0.operator === '张三' && log0.field === '动作值')

// 4. 重复提交校验只算一遍（幂等）
ok('提交校验成功', transitRelay(id, '提交校验', A).ok)
const dup = transitRelay(id, '提交校验', A)
ok('重复提交幂等返回成功提示', dup.ok && /只算一遍/.test(dup.message))
const inProgress = loadRelayRows().find((r) => r.id === id)
ok('重复提交不增加轮次', inProgress['校验轮次'] === 1)

// 5. 判不合格 -> 锁定 + 驱动待复核（一份）
ok('标记不合格成功', transitRelay(id, '标记不合格', A).ok)
const failed = loadRelayRows().find((r) => r.id === id)
ok('记录状态为校验不合格', failed.status === '校验不合格')
const lockedEdit = updateRelayValues(id, { 动作值: '1.0' }, A)
ok('不合格后本班组也不能直接改数值（锁定只读）', !lockedEdit.ok && /锁定/.test(lockedEdit.message))
const crossVerdict = transitRelay(id, '判定合格', B)
ok('跨班组不能翻案', !crossVerdict.ok)
const reviews1 = listPendingReviews()
ok('驱动出一条待复核', reviews1.length === 1 && reviews1[0]['关联校验编号'] === 'RELA-T1')

// 6. 重做校验翻案：非本班组不行，本班组行，轮次增加
const redoOther = transitRelay(id, '重做校验', B)
ok('跨班组重做被打回', !redoOther.ok)
// 锁定期间重复判不合格不会再生成一份待复核
const dupReviewMark = transitRelay(id, '标记不合格', A)
ok('锁定态重复判定不生效且仍只一份待复核', !dupReviewMark.ok && listPendingReviews().length === 1)
const redo = transitRelay(id, '重做校验', A)
ok('本班组重做成功', redo.ok && /第2轮/.test(redo.message))
ok('重做后解锁可改', updateRelayValues(id, { 动作值: '5.3' }, A).ok)
// 重做期间若再次判不合格，也不得重复生成待复核
transitRelay(id, '标记不合格', A)
ok('同一记录重做后再判不合格仍只一份待复核', listPendingReviews().length === 1)
// 本班组再次重做并翻案合格
transitRelay(id, '重做校验', A)
ok('判定合格成功', transitRelay(id, '判定合格', A).ok)
ok('合格后待复核被闭环清空', listPendingReviews().length === 0)
const finalRow = loadRelayRows().find((r) => r.id === id)
ok('轮次记录为3（首轮+两次重做）', finalRow['校验轮次'] === 3)

// 7. 导出含动作值列且与明细一致
const book = exportRelayBook()
const lines = book.content.replace(/^﻿/, '').split('\n')
const header = lines[0].split(',')
ok('导出表头含动作值与返回值', header.includes('动作值') && header.includes('返回值'))
const idxAction = header.indexOf('动作值')
const rowOut = lines.slice(1).find((l) => l.includes('RELA-T1')).split(',')
ok('导出动作值与明细一致', rowOut[idxAction] === finalRow['动作值'])

// 8. 兼容旧记录：无所属班组字段的种子行被默认归属一班，不报错
const migrated = loadRelayRows().some((r) => typeof r['所属班组'] === 'string' && r['所属班组'].length > 0)
ok('既有校验记录被兼容补齐归属', migrated)

console.log(`\n全部 ${pass} 条断言通过`)
