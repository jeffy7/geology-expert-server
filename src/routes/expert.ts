import { Router } from 'express'
import { successResponse } from '../types'

const router = Router()

// 基础专家数据底账
export const EXPERT_DATABASE = [
  { id: 101, name: '张建军', gender: '男', level: 'province', majorId: '1', major: '矿产地质勘查', title: '教授级高级工程师', unit: '内蒙古大学地质工程系', mobileMask: '138****5621', score: 98, status: 1 },
  { id: 102, name: '李国祥', gender: '男', level: 'province', majorId: '2', major: '地球物理勘查', title: '高级工程师', unit: '自治区第二水文地质工程地质勘查院', mobileMask: '139****8823', score: 92, status: 1 },
  { id: 103, name: '王德胜', gender: '男', level: 'province', majorId: '3', major: '水文水资源地质', title: '研究员', unit: '中国地质科学院矿产资源研究所', mobileMask: '150****1192', score: 95, status: 1 },
  { id: 104, name: '赵丽娟', gender: '女', level: 'province', majorId: '4', major: '矿产资源储量核算', title: '高级工程师', unit: '自治区矿产资源评审委员会办公室', mobileMask: '186****4945', score: 85, status: 1 },
  { id: 105, name: '孙志刚', gender: '男', level: 'province', majorId: '5', major: '采矿工程与储量', title: '高级工程师', unit: '包钢矿业设计研究院', mobileMask: '137****9012', score: 91, status: 1 },
  { id: 106, name: '刘晓峰', gender: '男', level: 'city', majorId: '5', major: '采矿工程与储量', title: '高级工程师', unit: '赤峰市自然资源事务服务中心', mobileMask: '189****3341', score: 88, status: 1 },
  { id: 107, name: '陈宝林', gender: '男', level: 'province', majorId: '4', major: '矿产资源储量核算', title: '高级工程师', unit: '内蒙古矿业咨询服务中心', mobileMask: '133****6655', score: 90, status: 1 }
]

// 正在外呼调度中的状态机流水
let mockCallingList = [
  {
    id: 101,
    isLeader: true,
    isBackup: false,
    name: '张建军',
    major: '矿产地质勘查',
    phoneMask: '138****5621',
    callCount: 1,
    callStatus: 'calling',
    callStatusText: '电话呼叫中',
    lastCallTime: '2026-10-29 18:20:10',
    remark: '腾讯云语音 API 已下发呼叫流水，等待专家接听按键'
  },
  {
    id: 102,
    isLeader: false,
    isBackup: false,
    name: '李国祥',
    major: '地球物理勘查',
    phoneMask: '139****8823',
    callCount: 1,
    callStatus: 'confirmed',
    callStatusText: '已按1同意参会',
    lastCallTime: '2026-10-29 18:19:45',
    remark: '专家在手机上按 1 确认参会，已固化为正式评审专家'
  },
  {
    id: 104,
    isLeader: false,
    isBackup: false,
    name: '赵丽娟',
    major: '矿产资源储量核算',
    phoneMask: '186****4945',
    callCount: 2,
    callStatus: 'calling',
    callStatusText: '重试呼叫中',
    lastCallTime: '2026-10-29 18:20:30',
    remark: '初次外呼未应答，触发延迟 30 秒自动重试调度'
  }
]

// 专家列表 GET /etbApi/expert/list
router.get('/list', (_req, res) => {
  res.json(successResponse({
    records: EXPERT_DATABASE,
    total: EXPERT_DATABASE.length
  }))
})

// 计算可用专家候选总数 POST /etbApi/expert/countCandidates
router.post('/countCandidates', (req, res) => {
  const { level, majorId, avoidIds = [] } = req.body
  let pool = EXPERT_DATABASE.filter(e => !avoidIds.includes(e.id))
  if (level) pool = pool.filter(e => e.level === level)
  if (majorId) pool = pool.filter(e => e.majorId === majorId)

  res.json(successResponse({
    count: pool.length
  }))
})

// 获取当前调度中外呼进度 GET /etbApi/expert/callingProgress
router.get('/callingProgress', (_req, res) => {
  res.json(successResponse(mockCallingList))
})

// 模拟 VMS 腾讯云语音回调接口 POST /etbApi/expert-notice/callback
router.post('/callback', (req, res) => {
  const { expertId, keypress } = req.body
  const target = mockCallingList.find(e => e.id === Number(expertId))

  if (target) {
    if (keypress === '1') {
      target.callStatus = 'confirmed'
      target.callStatusText = '已按1同意参会'
      target.remark = '【VMS 回调】专家按 1 确认参会，状态机已锁定'
    } else if (keypress === '0') {
      target.callStatus = 'rejected'
      target.callStatusText = '专家按0拒绝'
      target.remark = '【VMS 回调】专家按 0 拒绝，触发自动补位'
    }
  }

  res.json(successResponse({ processed: true, target }))
})

export default router

