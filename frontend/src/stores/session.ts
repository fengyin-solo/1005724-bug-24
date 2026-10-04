import { defineStore } from 'pinia'

/** 参与保护校验的班组；校验记录归属哪个班组，动作值与返回值就只有该班组能改。 */
export const WORK_TEAMS = ['继电保护一班', '继电保护二班', '检修试验班'] as const
export type WorkTeam = (typeof WORK_TEAMS)[number]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    team: '继电保护一班' as WorkTeam,
    shiftLabel: '白班 08:00-20:00',
    scope: '变电站继电保护定值整定与二次设备检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.trim().length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      this.operator = name.trim() || '值班管理员'
    },
    setTeam(team: WorkTeam) {
      this.team = team
    },
  },
})
