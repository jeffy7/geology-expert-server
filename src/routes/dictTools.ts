import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket } from 'mysql2'

const router = Router()

import { NATIVE_AREA_TREE, NATIVE_MAJOR_TREE } from '../constants/nativeDictionaries'

// 0. 地区字典树 GET /etbApi/brace/braceDict/area/tree (1:1 对齐内蒙古12盟市)
router.get('/braceDict/area/tree', (_req, res) => {
  res.json(successResponse(NATIVE_AREA_TREE))
})

// 1. 专家专业全息树 GET /etbApi/expert-system/braceMajor/majorAllTree (从数据库动态查询并构建两级树)
router.get('/braceMajor/majorAllTree', async (req, res) => {
  try {
    const { majorName } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        CAST(IFNULL(parent_id, '0') AS CHAR) as parentId,
        major_name as name,
        IFNULL(major_code, 'A') as code,
        IFNULL(custom_code, 'A') as customCode,
        IFNULL(major_path, 'A') as majorPath,
        IFNULL(grade, 0) as grade,
        1 as sort,
        IFNULL(major_status, 0) as majorStatus
       FROM brace_major
       ORDER BY grade ASC, CAST(id AS UNSIGNED) ASC, id ASC`
    )

    if (rows.length === 0) {
      return res.json(successResponse(NATIVE_MAJOR_TREE))
    }

    // 构建两级树
    const roots = rows.filter(r => String(r.parentId) === '0' || String(r.parentId) === '')
    const actualRoots = roots.length > 0 ? roots : rows.filter(r => r.grade === 0)

    const tree = actualRoots.map((root: any) => {
      let children = rows.filter((r: any) => String(r.parentId) === String(root.id))
      if (majorName) {
        children = children.filter((c: any) => c.name && c.name.includes(String(majorName)))
      }
      return {
        ...root,
        children: children.length > 0 ? children : null
      }
    })

    const filteredTree = majorName
      ? tree.filter((t: any) => (t.name && t.name.includes(String(majorName))) || (t.children && t.children.length > 0))
      : tree

    res.json(successResponse(filteredTree))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取专业树失败: ' + error.message))
  }
})

// 1.1 保存专家专业 POST /etbApi/expert-system/braceMajor/save
router.post('/braceMajor/save', async (req, res) => {
  try {
    const { id, name, code, parentId, grade } = req.body
    if (!name) return res.status(400).json(errorResponse('专业名称不能为空'))

    if (id) {
      await pool.query(
        `UPDATE brace_major SET major_name = ?, major_code = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ?`,
        [name, code || 'A', String(id)]
      )
      res.json(successResponse({ success: true }, '专家专业更新成功'))
    } else {
      const newId = Date.now().toString()
      await pool.query(
        `INSERT INTO brace_major (id, major_name, major_code, custom_code, major_path, grade, parent_id, major_status, insert_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
        [newId, name, code || 'A09', code || 'A09', code || 'A09', grade || 1, parentId || '1']
      )
      res.json(successResponse({ success: true, id: newId }, '专家专业新增成功'))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('保存专业失败: ' + error.message))
  }
})

// 1.2 删除专家专业 POST /etbApi/expert-system/braceMajor/delete
router.post('/braceMajor/delete', async (req, res) => {
  try {
    const { id } = req.body
    if (!id) return res.status(400).json(errorResponse('缺少专业ID'))
    await pool.query(`DELETE FROM brace_major WHERE CAST(id AS CHAR) = ?`, [String(id)])
    res.json(successResponse({ success: true }, '专家专业删除成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('删除专业失败: ' + error.message))
  }
})

// 2. 专家职称列表与分页 GET /etbApi/expert-system/braceRank/page 与 list
router.get('/braceRank/page', async (req, res) => {
  try {
    const { rankName, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let where = 'WHERE 1=1'
    const params: any[] = []
    if (rankName) {
      where += ' AND rank_name LIKE ?'
      params.push(`%${rankName}%`)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM brace_rank ${where}`, params)
    const total = Number(countRows[0].total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        rank_name as rankName,
        IFNULL(rank_status, 0) as rankStatus,
        insert_person_name as insertPersonName,
        DATE_FORMAT(insert_time, '%Y-%m-%d %H:%i:%s') as insertTime
       FROM brace_rank
       ${where}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
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

router.get('/braceRank/list', async (req, res) => {
  try {
    const { mid } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        rank_name as rankName,
        IFNULL(rank_status, 0) as rankStatus,
        IFNULL(rank_weight, 3) as rankWeight
       FROM brace_rank
       WHERE rank_status = 0
       ORDER BY rank_weight DESC, id ASC`
    )

    // 如果传入 mid，查询已关联的 rankIds
    if (mid) {
      const [boundRows] = await pool.query<RowDataPacket[]>(
        'SELECT CAST(brace_rank_id AS CHAR) as rankId FROM brace_major_rank WHERE CAST(brace_major_id AS CHAR) = ?',
        [String(mid)]
      )
      const boundIds = boundRows.map(b => b.rankId)
      return res.json(successResponse({
        allRanks: rows,
        selectedRankIds: boundIds.length > 0 ? boundIds : rows.map(r => String(r.id))
      }))
    }

    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取职称列表失败'))
  }
})

// 2.1 保存专家职称 POST /etbApi/expert-system/braceRank/save
router.post('/braceRank/save', async (req, res) => {
  try {
    const { id, rankName, rankWeight = 3, rankStatus = 0 } = req.body
    if (!rankName) return res.status(400).json(errorResponse('职称名称不能为空'))

    if (id) {
      await pool.query(
        `UPDATE brace_rank SET rank_name = ?, rank_weight = ?, rank_status = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ?`,
        [rankName, Number(rankWeight), rankStatus, String(id)]
      )
      res.json(successResponse({ success: true }, '职称更新成功'))
    } else {
      const newId = Date.now().toString()
      await pool.query(
        `INSERT INTO brace_rank (id, rank_name, rank_weight, rank_status, insert_time) VALUES (?, ?, ?, ?, NOW())`,
        [newId, rankName, Number(rankWeight), rankStatus]
      )
      res.json(successResponse({ success: true, id: newId }, '职称新增成功'))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('保存职称失败: ' + error.message))
  }
})

// 2.2 专家职称启用/禁用切换 POST /etbApi/expert-system/braceRank/toggleStatus
router.post('/braceRank/toggleStatus', async (req, res) => {
  try {
    const { id, status } = req.body
    if (!id) return res.status(400).json(errorResponse('缺少职称ID'))
    const rankStatus = (status === true || status === 1 || status === '1') ? 0 : 1
    await pool.query('UPDATE brace_rank SET rank_status = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ?', [rankStatus, String(id)])
    res.json(successResponse({ success: true }, '状态更新成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('状态切换失败: ' + error.message))
  }
})

// 2.3 删除专家职称 POST /etbApi/expert-system/braceRank/delete
router.post('/braceRank/delete', async (req, res) => {
  try {
    const { id } = req.body
    if (!id) return res.status(400).json(errorResponse('缺少职称ID'))
    await pool.query(`DELETE FROM brace_rank WHERE CAST(id AS CHAR) = ?`, [String(id)])
    res.json(successResponse({ success: true }, '职称删除成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('删除职称失败: ' + error.message))
  }
})

// 3. 专家所学专业字典树 GET /etbApi/brace/braceDict/learn_major/tree
let dynamicLearnMajorTree = [
  { id: '19', name: '金属矿产地质与勘查技术', grade: 0, majorStatus: 1, children: [] },
  { id: '20', name: '资源勘查工程', grade: 0, majorStatus: 1, children: [] },
  { id: '21', name: '矿山工程', grade: 0, majorStatus: 1, children: [] },
  { id: '22', name: '矿业工程', grade: 0, majorStatus: 1, children: [] },
  { id: '23', name: '地质工程', grade: 0, majorStatus: 1, children: [] },
  { id: '24', name: '矿产资源工程', grade: 0, majorStatus: 1, children: [] },
  { id: '25', name: '矿业经济与管理', grade: 0, majorStatus: 1, children: [] },
  { id: '26', name: '地质学', grade: 0, majorStatus: 1, children: [] },
  { id: '27', name: '矿物加工工程', grade: 0, majorStatus: 1, children: [] }
]

router.get('/braceDict/learn_major/tree', (req, res) => {
  const { name } = req.query
  if (name) {
    const kw = String(name).trim()
    const filtered = dynamicLearnMajorTree.filter(item => item.name.includes(kw))
    return res.json(successResponse(filtered))
  }
  res.json(successResponse(dynamicLearnMajorTree))
})

// 3.1 保存所学专业 POST /etbApi/brace/braceDict/learn_major/save
router.post('/braceDict/learn_major/save', (req, res) => {
  const { id, name, parentId } = req.body
  if (!name) return res.status(400).json(errorResponse('专业名称不能为空'))

  if (id) {
    const updateNode = (nodes: any[]): boolean => {
      for (const n of nodes) {
        if (n.id === String(id)) {
          n.name = name
          return true
        }
        if (n.children && updateNode(n.children)) return true
      }
      return false
    }
    updateNode(dynamicLearnMajorTree)
    return res.json(successResponse({ success: true }, '修改专业成功'))
  }

  const newNode = {
    id: String(Date.now()),
    name,
    grade: parentId ? 1 : 0,
    majorStatus: 0,
    children: []
  }

  if (parentId) {
    const addSubNode = (nodes: any[]): boolean => {
      for (const n of nodes) {
        if (n.id === String(parentId)) {
          if (!n.children) n.children = []
          n.children.push(newNode)
          return true
        }
        if (n.children && addSubNode(n.children)) return true
      }
      return false
    }
    addSubNode(dynamicLearnMajorTree)
  } else {
    dynamicLearnMajorTree.push(newNode)
  }

  res.json(successResponse({ success: true, id: newNode.id }, '添加专业成功'))
})

// 3.2 切换所学专业启用/禁用 POST /etbApi/brace/braceDict/learn_major/toggleStatus
router.post('/braceDict/learn_major/toggleStatus', (req, res) => {
  const { id, status } = req.body
  if (!id) return res.status(400).json(errorResponse('缺少专业ID'))

  const toggleNode = (nodes: any[]): boolean => {
    for (const n of nodes) {
      if (n.id === String(id)) {
        n.majorStatus = (status === true || status === 1 || status === '1') ? 1 : 0
        return true
      }
      if (n.children && toggleNode(n.children)) return true
    }
    return false
  }
  toggleNode(dynamicLearnMajorTree)
  res.json(successResponse({ success: true }, '状态更新成功'))
})

// 3.2 删除所学专业 POST /etbApi/brace/braceDict/learn_major/delete
router.post('/braceDict/learn_major/delete', (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(errorResponse('缺少专长ID'))

  dynamicLearnMajorTree = dynamicLearnMajorTree.filter(n => {
    if (n.id === String(id)) return false
    if (n.children) {
      n.children = n.children.filter((c: any) => c.id !== String(id))
    }
    return true
  })

  res.json(successResponse({ success: true }, '删除专长成功'))
})

// 4. 专家学历字典列表 GET /etbApi/brace/braceDict/edu/list
let dynamicEduList = [
  { id: '14', name: '本科', status: 1, sort: 1 },
  { id: '15', name: '硕士研究生', status: 1, sort: 2 },
  { id: '16', name: '博士研究生', status: 1, sort: 3 },
  { id: '17', name: '大专', status: 1, sort: 4 },
  { id: '18', name: '中专及其他', status: 1, sort: 5 }
]

router.get('/braceDict/edu/list', (_req, res) => {
  res.json(successResponse(dynamicEduList))
})

// 4.1 保存学历 POST /etbApi/brace/braceDict/edu/save
router.post('/braceDict/edu/save', (req, res) => {
  const { id, name, status } = req.body
  if (!name) return res.status(400).json(errorResponse('学历名称不能为空'))

  if (id) {
    const item = dynamicEduList.find(e => e.id === String(id))
    if (item) {
      item.name = name
      if (status !== undefined) item.status = status
    }
    return res.json(successResponse({ success: true }, '学历修改成功'))
  }

  const newItem = {
    id: String(Date.now()),
    name,
    status: status ?? 0,
    sort: dynamicEduList.length + 1
  }
  dynamicEduList.push(newItem)
  res.json(successResponse(newItem, '学历添加成功'))
})

// 4.2 删除学历 POST /etbApi/brace/braceDict/edu/delete
router.post('/braceDict/edu/delete', (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(errorResponse('缺少学历ID'))
  dynamicEduList = dynamicEduList.filter(e => e.id !== String(id))
  res.json(successResponse({ success: true }, '学历删除成功'))
})

// 4.3 切换学历启用/禁用 POST /etbApi/brace/braceDict/edu/toggleStatus
router.post('/braceDict/edu/toggleStatus', (req, res) => {
  const { id, status } = req.body
  if (!id) return res.status(400).json(errorResponse('缺少学历ID'))
  const item = dynamicEduList.find(e => e.id === String(id))
  if (item) {
    item.status = (status === true || status === 1 || status === '1') ? 1 : 0
  }
  res.json(successResponse({ success: true }, '学历状态更新成功'))
})

// 4.9 原生项目字典列表查询 GET /etbApi/brace/braceDict/list?parentId=xxx (严格对齐抓包 HAR)
const HAR_DICT_MAP: Record<string, any[]> = {
  // 审查形式
  '28': [
    { id: '29', type: 'common', name: '会议审查', code: 'A01', parentId: '28' },
    { id: '30', type: 'common', name: '函审', code: 'A02', parentId: '28' }
  ],
  // 申报矿山建设规模
  '30': [
    { id: '1777534261857419266', type: 'common', name: '小型/露天', code: 'B03', parentId: '30' },
    { id: '31', type: 'common', name: '中型/露天', code: 'B01', parentId: '30' },
    { id: '1752594205687320577', type: 'common', name: '大型及以上/露天', code: 'B02', parentId: '30' },
    { id: '1777534357860843522', type: 'common', name: '小型/井工', code: 'B04', parentId: '30' },
    { id: '1777534581882814465', type: 'common', name: '中型/井工', code: 'B05', parentId: '30' },
    { id: '1777534627139354626', type: 'common', name: '大型及以上/井工', code: 'B06', parentId: '30' },
    { id: '1777534787143663618', type: 'common', name: '小型', code: 'B07', parentId: '30' },
    { id: '1777534819766960130', type: 'common', name: '中型', code: 'B08', parentId: '30' },
    { id: '1777534850620260353', type: 'common', name: '大型及以上', code: 'B09', parentId: '30' },
    { id: '1960616139477790721', type: 'common', name: '其他', code: 'B10', parentId: '30' }
  ],
  // 主要矿种
  '32': [
    { id: '33', type: 'common', name: '煤矿', code: 'C01', parentId: '32' },
    { id: '1752594044705738753', type: 'common', name: '金属', code: 'C02', parentId: '32' },
    { id: '1777533589338521602', type: 'common', name: '非金属', code: 'C03', parentId: '32' },
    { id: '1777534019334373377', type: 'common', name: '矿泉水', code: 'C04', parentId: '32' },
    { id: '1777533950753308674', type: 'common', name: '地热', code: 'C05', parentId: '32' },
    { id: '1777534138448412673', type: 'common', name: '煤层气', code: 'C06', parentId: '32' }
  ],
  // 评审品目
  '34': [
    { id: '36', type: 'common', name: '开发利用方案审查', code: 'D02', parentId: '34' },
    { id: '37', type: 'common', name: '非法采矿、破坏性采矿造成矿产资源破坏的价值鉴定', code: 'D03', parentId: '34' },
    { id: '38', type: 'common', name: '压覆报告评审', code: 'D04', parentId: '34' },
    { id: '39', type: 'common', name: '压覆查询', code: 'D05', parentId: '34' },
    { id: '40', type: 'common', name: '储量统计质量监控', code: 'D06', parentId: '34' },
    { id: '41', type: 'common', name: '其他', code: 'D07', parentId: '34' },
    { id: '1960615227459940353', type: 'common', name: '勘查方案评审', code: 'D08', parentId: '34' },
    { id: '1960615434952159234', type: 'common', name: '开采方案评审', code: 'D09', parentId: '34' },
    { id: '35', type: 'common', name: '矿产资源储量报告评审', code: 'D01', parentId: '34' }
  ],
  // 申请事由
  '1787384896661565442': [
    { id: '1788496607752814593', type: 'common', name: '开发利用方案审查', code: 'E03', parentId: '1787384896661565442' },
    { id: '1960615675721986050', type: 'common', name: '首次申请', code: 'E11', parentId: '1787384896661565442' },
    { id: '1976566272178565122', type: 'common', name: '变更开采方式', code: 'E14', parentId: '1787384896661565442' },
    { id: '1788496555391123457', type: 'common', name: '非法采矿鉴定', code: 'E01', parentId: '1787384896661565442' },
    { id: '1788496708948787202', type: 'common', name: '涉及权益金出让收益处置', code: 'E04', parentId: '1787384896661565442' },
    { id: '1788496797494738945', type: 'common', name: '涉及国家权益处置', code: 'E05', parentId: '1787384896661565442' },
    { id: '1788496891094827010', type: 'common', name: '编制评审开发利用方案审查', code: 'E06', parentId: '1787384896661565442' },
    { id: '1788496975534555138', type: 'common', name: '探矿权转采矿权', code: 'E07', parentId: '1787384896661565442' },
    { id: '1788497053598941186', type: 'common', name: '采矿权变更矿种或范围', code: 'E08', parentId: '1787384896661565442' },
    { id: '1788497225095643138', type: 'common', name: '非油气矿在采矿期间累计查明资源量发生重大', code: 'E09', parentId: '1787384896661565442' },
    { id: '1788497300035272705', type: 'common', name: '建设项目压覆重要矿产', code: 'E10', parentId: '1787384896661565442' },
    { id: '1960615716855525377', type: 'common', name: '延续申请', code: 'E12', parentId: '1787384896661565442' },
    { id: '1960615881481957377', type: 'common', name: '变更申请（变更勘查区域、含合并或分立）', code: 'E13', parentId: '1787384896661565442' },
    { id: '1960615957138812930', type: 'common', name: '勘查方案重大调整', code: 'E15', parentId: '1787384896661565442' },
    { id: '1988519337571954689', type: 'common', name: '财政出资项目矿产资源储量管理', code: 'E16', parentId: '1787384896661565442' }
  ]
}

router.get('/braceDict/list', (req, res) => {
  const parentId = String(req.query.parentId || '')
  const data = HAR_DICT_MAP[parentId] || []
  res.json(successResponse(data))
})

// 5. 项目字典树 GET /etbApi/brace/braceDict/tree
let dynamicDictTree = [
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

router.get('/braceDict/tree', (_req, res) => {
  res.json(successResponse(dynamicDictTree))
})

// 5.1 保存字典节点 POST /etbApi/brace/braceDict/save
router.post('/braceDict/save', (req, res) => {
  const { id, name, code, parentId } = req.body
  if (!name) return res.status(400).json(errorResponse('字典名称不能为空'))

  if (id) {
    const updateNode = (nodes: any[]): boolean => {
      for (const n of nodes) {
        if (n.id === String(id)) {
          n.name = name
          if (code) n.code = code
          return true
        }
        if (n.children && updateNode(n.children)) return true
      }
      return false
    }
    updateNode(dynamicDictTree)
    return res.json(successResponse({ success: true }, '字典更新成功'))
  }

  const newNode = {
    id: String(Date.now()),
    name,
    code: code || 'DICT_' + Math.floor(Math.random() * 1000),
    children: []
  }

  if (parentId) {
    const parent = dynamicDictTree.find(n => n.id === String(parentId))
    if (parent) {
      if (!parent.children) parent.children = []
      parent.children.push(newNode)
    } else {
      dynamicDictTree.push(newNode)
    }
  } else {
    dynamicDictTree.push(newNode)
  }

  res.json(successResponse(newNode, '新增字典节点成功'))
})

// 5.2 删除字典节点 POST /etbApi/brace/braceDict/delete
router.post('/braceDict/delete', (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(errorResponse('缺少字典ID'))

  dynamicDictTree = dynamicDictTree.filter(n => {
    if (n.id === String(id)) return false
    if (n.children) {
      n.children = n.children.filter((c: any) => c.id !== String(id))
    }
    return true
  })

  res.json(successResponse({ success: true }, '删除字典节点成功'))
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

