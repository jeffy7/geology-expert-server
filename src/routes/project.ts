import { Router } from 'express'
import { successResponse } from '../types'

const router = Router()

// 模拟项目内存数据源
let projectList = [
  {
    id: 1,
    projectCode: 'NM-KC-2026-001',
    projectName: '内蒙古某特大型稀土矿区深部储量核实评审',
    declareUnit: '内蒙古自治区第七地质矿产勘查开发有限责任公司',
    exploreUnit: '自治区第七地质勘查开发院',
    reviewTime: '2026-11-05 09:00:00',
    location: '自治区储量评审中心 301 会议室',
    mineralType: '1',
    auditStatus: 1,
    auditStatusName: '已审核',
    extractStatus: 1,
    extractStatusName: '抽取中',
    expertCount: 5,
    confirmedCount: 3,
    avoidExpertIds: [104],
    createTime: '2026-10-25 10:00:00'
  },
  {
    id: 2,
    projectCode: 'NM-KC-2026-002',
    projectName: '锡林郭勒盟白音华煤田勘探资源储量报告评审',
    declareUnit: '内蒙古矿业集团技术研发部',
    exploreUnit: '内蒙古煤田地质局109队',
    reviewTime: '2026-11-08 14:30:00',
    location: '自治区储量评审中心 302 会议室',
    mineralType: '2',
    auditStatus: 0,
    auditStatusName: '未审核',
    extractStatus: 0,
    extractStatusName: '未抽取',
    expertCount: 7,
    confirmedCount: 0,
    avoidExpertIds: [],
    createTime: '2026-10-28 14:20:00'
  }
]

// 项目列表 GET /etbApi/project/list
router.get('/list', (req, res) => {
  const { projectCode, projectName, extractStatus } = req.query
  let result = [...projectList]

  if (projectCode) {
    result = result.filter(p => p.projectCode.includes(projectCode as string))
  }
  if (projectName) {
    result = result.filter(p => p.projectName.includes(projectName as string))
  }
  if (extractStatus !== undefined && extractStatus !== '') {
    result = result.filter(p => p.extractStatus === Number(extractStatus))
  }

  res.json(successResponse({
    records: result,
    total: result.length
  }))
})

// 项目详情 GET /etbApi/project/detail/:id
router.get('/detail/:id', (req, res) => {
  const id = Number(req.params.id)
  const item = projectList.find(p => p.id === id)
  if (!item) {
    res.status(404).json({ code: 404, message: '项目不存在', success: false })
    return
  }
  res.json(successResponse(item))
})

// 创建/修改项目 POST /etbApi/project/save
router.post('/save', (req, res) => {
  const data = req.body
  if (data.id) {
    const index = projectList.findIndex(p => p.id === data.id)
    if (index !== -1) {
      projectList[index] = { ...projectList[index], ...data }
      res.json(successResponse(projectList[index], '项目更新成功'))
      return
    }
  }

  const newItem = {
    id: projectList.length + 1,
    projectCode: data.projectCode || `NM-KC-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    projectName: data.projectName,
    declareUnit: data.declareUnit,
    exploreUnit: data.exploreUnit || '',
    reviewTime: data.reviewTime,
    location: data.location || '自治区储量评审中心会议室',
    mineralType: data.mineralType || '1',
    auditStatus: 0,
    auditStatusName: '未审核',
    extractStatus: 0,
    extractStatusName: '未抽取',
    expertCount: 5,
    confirmedCount: 0,
    avoidExpertIds: [],
    createTime: new Date().toISOString().replace('T', ' ').substring(0, 19)
  }
  projectList.unshift(newItem)
  res.json(successResponse(newItem, '项目创建成功'))
})

export default router

