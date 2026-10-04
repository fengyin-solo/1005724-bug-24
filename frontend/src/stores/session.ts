import { defineStore } from 'pinia'

// 可切换的值班班组：演示「按归属设限」时，换一个班组再去改别班组的记录会被打回。
export const TEAMS = ['继电保护一班', '继电保护二班', '综合检修班'] as const

const TEAM_KEY = 'substation-protection:team'
const OPERATOR_KEY = 'substation-protection:operator'

function read(key: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  return window.localStorage.getItem(key) || fallback
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: read(OPERATOR_KEY, '值班管理员'),
    team: read(TEAM_KEY, TEAMS[0]),
    teams: TEAMS as unknown as string[],
    shiftLabel: '白班 08:00-20:00',
    scope: '变电站继电保护定值整定与二次设备检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      this.team = team
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TEAM_KEY, team)
      }
    },
    setOperator(operator: string) {
      this.operator = operator
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(OPERATOR_KEY, operator)
      }
    },
  },
})
