import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket } from 'mysql2'

const router = Router()

// 1. 专家专业全息树 GET /etbApi/expert-system/braceMajor/majorAllTree
router.get('/braceMajor/majorAllTree', async (req, res) => {
  try {
    const { majorName } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id, 
        major_name as name, 
        major_code as code, 
        custom_code as customCode, 
        major_path as majorPath, 
        grade, 
        CAST(parent_id AS CHAR) as parentId, 
        major_status as majorStatus
       FROM brace_major
       ORDER BY grade ASC, id ASC`
    )

    // 构建两级树结构
    const rootNodes: any[] = []
    const map = new Map<string, any>()

    rows.forEach(r => {
      const node = { ...r, children: [] }
      map.set(r.id, node)
      if (r.grade === 0 || r.parentId === '0' || !map.has(r.parentId)) {
        rootNodes.push(node)
      } else {
        const parent = map.get(r.parentId)
        if (parent) {
          parent.children.push(node)
        }
      }
    })

    // 兜底保证有专家专业根节点
    const result = rootNodes.length > 0 ? rootNodes : [
      {
        id: '1',
        name: '专家专业',
        code: 'A',
        customCode: 'A',
        majorPath: 'A',
        grade: 0,
        children: [
          { id: '11', name: '地质矿产（金属非金属资源储量核算）', code: 'A01', grade: 1 },
          { id: '12', name: '油气矿产（地质）', code: 'A02', grade: 1 },
          { id: '13', name: '地质矿产（经济）', code: 'A03', grade: 1 },
          { id: '14', name: '水文地质与环境地质', code: 'A04', grade: 1 },
          { id: '15', name: '采矿工程（井工/露天）', code: 'A05', grade: 1 }
        ]
      }
    ]

    res.json(successResponse(result))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取专业全息树异常'))
  }
})

// 2. 专家职称列表与分页 GET /etbApi/expert-system/braceRank/page 与 list
router.get('/braceRank/page', async (req, res) => {
  try {
    const { current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    const [countRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as total FROM brace_rank')
    const total = countRows[0].total

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        rank_name as rankName,
        IFNULL(rank_status, 0) as rankStatus,
        3 as rankWeight,
        insert_person_name as insertPersonName,
        DATE_FORMAT(insert_time, '%Y-%m-%d %H:%i:%s') as insertTime
       FROM brace_rank
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [ps, offset]
    )

    res.json(successResponse({
      total,
      list: rows,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取职称列表失败'))
  }
})

router.get('/braceRank/list', async (_req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        rank_name as rankName,
        IFNULL(rank_status, 0) as rankStatus,
        3 as rankWeight
       FROM brace_rank
       ORDER BY id ASC`
    )
    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取职称列表失败'))
  }
})

// 3. 专家所学专业字典树 GET /etbApi/brace/braceDict/learn_major/tree
router.get('/braceDict/learn_major/tree', (_req, res) => {
  const tree = [
    {
      id: '19',
      name: '地质学类与勘查技术',
      code: 'B',
      grade: 0,
      children: [
        { id: '1901', name: '资源勘查工程', code: 'B01', grade: 1 },
        { id: '1902', name: '地质工程', code: 'B02', grade: 1 },
        { id: '1903', name: '水文与水资源工程', code: 'B03', grade: 1 },
        { id: '1904', name: '地球物理学', code: 'B04', grade: 1 }
      ]
    },
    {
      id: '20',
      name: '矿业工程与安全工程',
      code: 'C',
      grade: 0,
      children: [
        { id: '2001', name: '采矿工程', code: 'C01', grade: 1 },
        { id: '2002', name: '矿物加工工程', code: 'C02', grade: 1 },
        { id: '2003', name: '安全工程', code: 'C03', grade: 1 }
      ]
    }
  ]
  res.json(successResponse(tree))
})

// 4. 专家学历字典列表 GET /etbApi/brace/braceDict/edu/list
router.get('/braceDict/edu/list', (_req, res) => {
  const eduList = [
    { id: '14', name: '本科', status: 0, sort: 1 },
    { id: '15', name: '硕士研究生', status: 0, sort: 2 },
    { id: '16', name: '博士研究生', status: 0, sort: 3 },
    { id: '17', name: '大专', status: 0, sort: 4 },
    { id: '18', name: '中专及其他', status: 0, sort: 5 }
  ]
  res.json(successResponse(eduList))
})

// 5. 项目字典树 GET /etbApi/brace/braceDict/tree
router.get('/braceDict/tree', (_req, res) => {
  const dictTree = [
    {
      id: '100',
      name: '申报事由',
      code: 'APPLY_REASON',
      children: [
        { id: '1001', name: '首次申请', code: 'FIRST' },
        { id: '1002', name: '变更申请', code: 'CHANGE' },
        { id: '1003', name: '复核申请', code: 'RECHECK' }
      ]
    },
    {
      id: '200',
      name: '矿产类别',
      code: 'MINERAL_TYPE',
      children: [
        { id: '2001', name: '能源矿产（煤炭）', code: 'COAL' },
        { id: '2002', name: '金属矿产（稀土、铜、铁）', code: 'METAL' },
        { id: '2003', name: '非金属矿产（萤石、高岭土）', code: 'NON_METAL' },
        { id: '2004', name: '水气矿产', code: 'WATER_GAS' }
      ]
    },
    {
      id: '300',
      name: '评审地点/会议室',
      code: 'EVAL_ROOM',
      children: [
        { id: '3001', name: '储量评审中心316会议室', code: 'ROOM_316' },
        { id: '3002', name: '自治区地调院402多功能厅', code: 'ROOM_402' },
        { id: '3003', name: '矿区现场核查评审', code: 'FIELD' }
      ]
    }
  ]
  res.json(successResponse(dictTree))
})

// 6. 短信群发分页与详情 GET /etbApi/brace/bulk-sms/page & detail-page
router.get('/bulk-sms/page', async (req, res) => {
  try {
    const { current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))

    const mockSmsList = [
      {
        id: '2100771596670078978',
        content: '告知提醒：尊敬的专家，您在本年度记分周期累计记分达4分，告知提醒一次，望引以为戒，规范履职，请到评审中心403领取记分通知。',
        count: 3,
        successCount: 3,
        insertTime: '2026-10-24 16:30:12'
      },
      {
        id: '2054734791491235841',
        content: '会议通知：关于召开内蒙古自治区特大型矿区储量核查专家现场评审会的通知，请准时出席。',
        count: 4,
        successCount: 4,
        insertTime: '2026-08-15 09:20:00'
      }
    ]

    res.json(successResponse({
      total: mockSmsList.length,
      list: mockSmsList,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取短信群发列表异常'))
  }
})

router.get('/bulk-sms/detail-page', (req, res) => {
  const mockDetails = [
    { name: '初国明', phone: '18947173071', status: 1, sendDateTime: '2026-10-24 16:30:15' },
    { name: '丁建', phone: '13722113735', status: 1, sendDateTime: '2026-10-24 16:30:16' },
    { name: '刘剑', phone: '13789518785', status: 1, sendDateTime: '2026-10-24 16:30:16' }
  ]
  res.json(successResponse({
    total: mockDetails.length,
    list: mockDetails,
    current: 1,
    size: 10
  }))
})

// 7. 发起短信群发 POST /etbApi/iot/bulk-sms/start
router.post('/bulk-sms/start', (_req, res) => {
  res.json(successResponse('开始通知', '短信群发任务已提交，调度引擎外呼中'))
})

export default router

