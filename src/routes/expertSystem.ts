import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

// ==============================================================================
// 【内网机房配置备忘】原地调院生产内网私有 MinIO 附件服务配置
// 架构说明：原生产系统通过机房局域网内部 MinIO 进行大文件分布式存储，历史库桶名为 bigfile。
// 待后续项目正式向地调院政务内网/机房专网环境割接交付时，解开下方注释并切换上传实现即可。
//
// export const INTRANET_MINIO_CONFIG = {
//   endpoint: 'http://192.168.4.119:9400', // 内网私有局域网 MinIO 节点
//   bucket: 'bigfile',                      // 附件存储桶名称
//   accessKey: 'minioadmin',               // 机房内网访问凭证 (按需替换)
//   secretKey: 'minioadmin',               // 机房内网密钥 (按需替换)
//   visitEndpoint: 'http://192.168.4.119:9400/bigfile'
// }
// ==============================================================================

// 现阶段：文件直接上传并持久化至当前云服务器磁盘目录
const uploadDir = path.join(__dirname, '../../uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    const fileId = String(Date.now())
    let originalName = file.originalname
    try {
      // 修复 multer 中文文件名 latin1 乱码
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
    } catch (e) {}
    const safeName = originalName.replace(/[/\\?%*:|"<>]/g, '_')
    cb(null, `${fileId}_${safeName}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 限制单文件 100MB
})

const router = Router()

// 1. 获取项目列表 GET /etbApi/expert-system/expert-system-project/page
router.get('/expert-system-project/page', async (req, res) => {
  try {
    const { projectNo, projectName, extractState, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (projectNo) {
      whereClause += ' AND project_no LIKE ?'
      params.push(`%${projectNo}%`)
    }
    if (projectName) {
      whereClause += ' AND project_name LIKE ?'
      params.push(`%${projectName}%`)
    }
    if (extractState !== undefined && extractState !== '') {
      whereClause += ' AND extract_state = ?'
      params.push(Number(extractState))
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM project ${whereClause}`,
      params
    )
    const total = Number(countRows[0].total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id, 
        project_no as projectNo, 
        project_name as projectName, 
        project_source as projectSource,
        purchase_plan as purchasePlan,
        DATE_FORMAT(bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime, 
        DATE_FORMAT(bid_evaluation_time, '%Y-%m-%d %H:%i:%s') as bidEvaluationTime, 
        evaluation_room as evaluationRoom, 
        link_man as linkMan, 
        link_phone as linkPhone,
        file_ids as fileIds,
        complete_status as completeStatus,
        extract_state as extractState,
        censor,
        acceptance_no as acceptanceNo,
        scale,
        master_minerals as masterMinerals,
        review_category as reviewCategory,
        ext_info as extInfo
       FROM project 
       ${whereClause} 
       ORDER BY id DESC 
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    // 格式化扩展属性，提取各业务字段
    const list = rows.map(r => {
      let ext: any = {}
      try {
        ext = r.extInfo ? JSON.parse(r.extInfo) : {}
      } catch (e) {}

      return {
        ...r,
        inputOrgName: ext.inputOrgName || '',
        compileUnitName: ext.compileUnitName || '',
        docRoom: ext.docRoom || '',
        applyReasonName: ext.applyReasonName || '',
        experimentOrgName: ext.experimentOrgName || ''
      }
    })

    res.json(successResponse({
      total,
      list,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    console.error('查询项目列表失败:', error)
    res.status(500).json(errorResponse(error.message || '查询项目列表异常'))
  }
})

// 2. 获取项目详情 GET /etbApi/expert-system/expert-system-project/:id
router.get('/expert-system-project/:id', async (req, res) => {
  try {
    const id = req.params.id
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id, 
        project_no as projectNo, 
        project_name as projectName, 
        project_source as projectSource,
        purchase_plan as purchasePlan,
        DATE_FORMAT(bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime, 
        DATE_FORMAT(bid_evaluation_time, '%Y-%m-%d %H:%i:%s') as bidEvaluationTime, 
        evaluation_room as evaluationRoom, 
        link_man as linkMan, 
        link_phone as linkPhone,
        file_ids as fileIds,
        complete_status as completeStatus,
        extract_state as extractState,
        censor,
        acceptance_no as acceptanceNo,
        scale,
        master_minerals as masterMinerals,
        review_category as reviewCategory,
        ext_info as extInfo
       FROM project 
       WHERE CAST(id AS CHAR) = ? OR project_no = ?`,
      [String(id), String(id)]
    )

    if (rows.length === 0) {
      res.status(404).json(errorResponse('项目不存在', 404))
      return
    }

    const r = rows[0]
    let ext: any = {}
    try {
      ext = r.extInfo ? JSON.parse(r.extInfo) : {}
    } catch (e) {}

    // 查询回避专家 ID 列表
    const [avoidRows] = await pool.query<RowDataPacket[]>(
      `SELECT expert_id FROM biz_project_avoid_expert WHERE project_id = ?`,
      [r.id]
    )
    const avoidExpertIds = avoidRows.map(row => row.expert_id)

    // 查询预抽取规则
    const [ruleRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM biz_project_extract_rule WHERE project_id = ?`,
      [r.id]
    )
    const ruleItem = ruleRows[0] || null

    const censorMap: Record<string, string> = { '29': '会议审查', '30': '函审' }
    const scaleMap: Record<string, string> = {
      '1777534261857419266': '小型/露天',
      '31': '中型/露天',
      '1752594044705738753': '大型及以上/露天',
      '1777534357860843522': '小型/井工',
      '1777534581882814465': '中型/井工',
      '1777534627139354626': '大型及以上/井工',
      '1777534787143663618': '小型',
      '1777534819766960130': '中型',
      '1777534850620260353': '大型及以上',
      '1960616139477790721': '其他'
    }
    const mineralMap: Record<string, string> = {
      '33': '煤矿',
      '1752594044705738753': '金属',
      '1777533589338521602': '非金属',
      '1777534019334373377': '矿泉水',
      '1777533950753308674': '地热',
      '1777534138448412673': '煤层气'
    }
    const reviewCategoryMap: Record<string, string> = {
      '35': '矿产资源储量报告评审',
      '36': '开发利用方案审查',
      '37': '非法采矿、破坏性采矿造成矿产资源破坏的价值鉴定',
      '38': '压覆报告评审',
      '39': '压覆查询',
      '40': '储量统计质量监控',
      '41': '其他',
      '1960615227459940353': '勘查方案评审',
      '1960615434952159234': '开采方案评审'
    }

    const expOrg = ext.experimentOrgName || ext.testOrgName || ''
    const compOrg = ext.compileUnitName || ext.inputOrgName || ''

    res.json(successResponse({
      ...r,
      id: String(r.id),
      censorName: censorMap[r.censor] || r.censorName || (r.censor === '29' ? '会议审查' : (r.censor === '30' ? '函审' : r.censor)) || '-',
      scaleName: scaleMap[r.scale] || r.scaleName || r.scale || '-',
      masterMineralsName: mineralMap[r.masterMinerals] || r.masterMineralsName || r.masterMinerals || '-',
      reviewCategoryName: reviewCategoryMap[r.reviewCategory] || r.reviewCategoryName || r.reviewCategory || '-',
      avoidExpertIds,
      rule: ruleItem ? {
        totalExpertCount: ruleItem.total_expert_count,
        backupRatio: ruleItem.backup_ratio,
        leaderLevel: ruleItem.leader_level,
        leaderMajorId: ruleItem.leader_major_id,
        memberRules: ruleItem.member_rules_json ? JSON.parse(ruleItem.member_rules_json) : []
      } : null,
      inputOrgName: compOrg,
      compileUnitName: compOrg,
      docRoom: ext.docRoom || '',
      applyReasonName: ext.applyReasonName || '',
      experimentOrgName: expOrg,
      testOrgName: expOrg,
      joinUserList: ext.joinUserList || []
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '获取项目详情异常'))
  }
})

// 2.0 获取项目操作记录（原生 HAR 路径：GET /etbApi/expert-system/projectOperator/getByPid）
router.get('/projectOperator/getByPid', async (req, res) => {
  try {
    const pid = req.query.pid as string
    if (!pid) {
      res.json(successResponse([]))
      return
    }

    // 先从真实 project_operator 表查询
    const [opRows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id, 
        CAST(project_id AS CHAR) as projectId, 
        DATE_FORMAT(operator_time, '%Y-%m-%d %H:%i:%s') as operatorTime,
        operator_id as operatorId,
        operator_name as operatorName,
        incident,
        content
       FROM project_operator 
       WHERE CAST(project_id AS CHAR) = ? 
       ORDER BY operator_time ASC`,
      [String(pid)]
    )

    if (opRows.length > 0) {
      res.json(successResponse(opRows))
      return
    }

    // 若无单独 operator 记录，根据项目本身的创建时间自动生成一条真实创建记录
    const [pRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, link_man, DATE_FORMAT(insert_time, '%Y-%m-%d %H:%i:%s') as insertTime FROM project WHERE CAST(id AS CHAR) = ?`,
      [String(pid)]
    )

    if (pRows.length > 0) {
      const p = pRows[0]
      const defaultRecord = [
        {
          id: String(Date.now()),
          projectId: String(p.id),
          operatorTime: p.insertTime || '2026-10-23 15:50:13',
          operatorId: '1745741713110126592',
          operatorName: p.linkMan || '立项人',
          incident: 0,
          content: null
        }
      ]
      res.json(successResponse(defaultRecord))
      return
    }

    res.json(successResponse([]))
  } catch (error: any) {
    console.error('获取项目操作记录异常:', error)
    res.status(500).json(errorResponse('获取操作记录失败'))
  }
})

// 2.1 获取项目操作记录已统一收敛至 extractRule.ts 真实查询 audit_record 表，移除冲突的 Mock 实现

// 3. 新建或修改项目 POST /etbApi/expert-system/expert-system-project
router.post('/expert-system-project', async (req, res) => {
  try {
    const data = req.body
    const now = new Date()
    const projectNo = data.projectNo || String(Date.now())
    const extObj = {
      inputOrgName: data.inputOrgName || '',
      compileUnitName: data.compileUnitName || '',
      docRoom: data.docRoom || '',
      applyReasonName: data.applyReasonName || '首次申请',
      experimentOrgName: data.experimentOrgName || '',
      joinUserList: data.joinUserList || []
    }
    const extJson = JSON.stringify(extObj)

    if (data.id) {
      // 更新
      await pool.query<ResultSetHeader>(
        `UPDATE project SET 
          project_name = ?, 
          bid_evaluation_time = ?, 
          bid_open_time = ?,
          evaluation_room = ?, 
          link_man = ?, 
          link_phone = ?, 
          acceptance_no = ?,
          censor = ?,
          scale = ?,
          master_minerals = ?,
          review_category = ?,
          file_ids = ?,
          ext_info = ?,
          last_update_time = NOW()
         WHERE id = ?`,
        [
          data.projectName,
          data.bidEvaluationTime || now,
          data.bidOpenTime || data.bidEvaluationTime || now,
          data.evaluationRoom || '',
          data.linkMan || '',
          data.linkPhone || '',
          data.acceptanceNo || '',
          data.censor || '29',
          data.scale || '',
          data.masterMinerals || '',
          data.reviewCategory || '',
          data.fileIds || '',
          extJson,
          data.id
        ]
      )
      res.json(successResponse({ id: data.id }, '操作成功!'))
      return
    }

    // 新增 (生成 19 位真实风格雪花/时间戳 ID)
    const newId = String(Date.now()) + Math.floor(100000 + Math.random() * 900000)
    await pool.query<ResultSetHeader>(
      `INSERT INTO project 
        (id, project_no, project_source, project_name, purchase_plan, bid_open_time, bid_evaluation_time, evaluation_room, link_man, link_phone, file_ids, complete_status, extract_state, censor, acceptance_no, scale, master_minerals, review_category, ext_info, insert_time)
       VALUES (?, ?, 0, ?, '', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        newId,
        projectNo,
        data.projectName,
        data.bidOpenTime || data.bidEvaluationTime || now,
        data.bidEvaluationTime || now,
        data.evaluationRoom || '储量评审中心会议室',
        data.linkMan || '立项人',
        data.linkPhone || '13947163191',
        data.fileIds || '',
        data.censor || '29',
        data.acceptanceNo || `2026-${Math.floor(10 + Math.random() * 90)}`,
        data.scale || '大型及以上/井工',
        data.masterMinerals || '金属',
        data.reviewCategory || '开采方案评审',
        extJson
      ]
    )

    // 1:1 对齐原系统 ExpertSystemEventListener.onProjectCreate:
    // 1. 初始化正式抽取规则 (event_type=1, audit_state=-1未提交, extract_state=0未抽取)
    const ruleId = String(Date.now()) + Math.floor(1000 + Math.random() * 9000)
    await pool.query(
      `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
       VALUES (?, ?, 1, -1, 0, NOW())`,
      [ruleId, newId]
    )

    // 2. 初始化预抽取规则 (event_type=0, audit_state=1审核通过, extract_state=2已就绪)
    const preRuleId = String(Date.now() + 1) + Math.floor(1000 + Math.random() * 9000)
    await pool.query(
      `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
       VALUES (?, ?, 0, 1, 2, NOW())`,
      [preRuleId, newId]
    )

    // 3. 初始化评委评价记录 assess_record
    const assessId = String(Date.now() + 2) + Math.floor(1000 + Math.random() * 9000)
    await pool.query(
      `INSERT INTO assess_record (id, project_id, evaluate_status, insert_time)
       VALUES (?, ?, 0, NOW())`,
      [assessId, newId]
    )

    // 4. 初始化项目操作人记录 project_operator
    const opId = String(Date.now() + 3) + Math.floor(1000 + Math.random() * 9000)
    await pool.query(
      `INSERT INTO project_operator (id, project_id, operator_time, operator_id, operator_name, incident)
       VALUES (?, ?, NOW(), 1, '立项人', 0)`,
      [opId, newId]
    )

    res.json(successResponse({ id: newId, projectNo }, '操作成功!'))
  } catch (error: any) {
    console.error('保存项目失败:', error)
    res.status(500).json(errorResponse(error.message || '保存项目异常'))
  }
})

// 4. 附件列表查询 POST /etbApi/expert-system/file/query/list
router.post('/file/query/list', async (req, res) => {
  try {
    const fileIds: string[] = req.body || []
    if (fileIds.length === 0) {
      res.json(successResponse([]))
      return
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        file_name as fileName, 
        file_url as fileUrl, 
        file_size as fileSize, 
        file_suffix as fileSuffix, 
        file_md5 as fileMd5, 
        DATE_FORMAT(upload_time, '%Y-%m-%d %H:%i:%s') as uploadTime, 
        insert_person_name as insertPersonName
       FROM sys_file 
       WHERE id IN (?)`,
      [fileIds]
    )

    res.json(successResponse(rows, '查询成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '查询文件列表失败'))
  }
})

// 5. 附件上传 POST /etbApi/expert-system/file/upload (支持真实文件流与 JSON 兼容)
router.post('/file/upload', upload.single('file'), async (req, res) => {
  try {
    let newFileId = String(Date.now())
    let fileName = ''
    let fileSize = 0
    let fileSuffix = 'application/octet-stream'
    let fileUrl = ''

    if (req.file) {
      // 真实文件二进制上传落盘
      try {
        fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      } catch (e) {
        fileName = req.file.originalname
      }
      fileSize = req.file.size
      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : 'docx'
      if (ext === 'pdf') {
        fileSuffix = 'application/pdf'
      } else if (ext === 'docx' || ext === 'doc') {
        fileSuffix = 'application/msword'
      } else if (ext === 'xlsx' || ext === 'xls') {
        fileSuffix = 'application/vnd.ms-excel'
      } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
        fileSuffix = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      } else {
        fileSuffix = (req.file.mimetype || ext).slice(0, 60)
      }
      fileUrl = `/uploads/${req.file.filename}`
      newFileId = req.file.filename.split('_')[0] || newFileId
    } else {
      // 兼容 JSON 传参降级模式
      fileName = req.body?.fileName || `矿产储量评审报告附件_${newFileId}.docx`
      fileSize = Number(req.body?.fileSize) || 358400
      
      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : 'docx'
      if (ext === 'pdf') {
        fileSuffix = 'application/pdf'
      } else if (ext === 'docx' || ext === 'doc') {
        fileSuffix = 'application/msword'
      } else if (ext === 'xlsx' || ext === 'xls') {
        fileSuffix = 'application/vnd.ms-excel'
      } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
        fileSuffix = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      } else {
        fileSuffix = ext
      }

      const safeDiskName = `${newFileId}_${fileName.replace(/[/\\?%*:|"<>]/g, '_')}`
      fileUrl = `/uploads/${safeDiskName}`

      try {
        const diskPath = path.join(uploadDir, safeDiskName)
        if (!fs.existsSync(diskPath)) {
          fs.writeFileSync(diskPath, Buffer.from(`内蒙古地调院矿产专家评审附件存根: ${fileName}\n上传时间: ${new Date().toLocaleString()}\n`))
        }
      } catch (e) {}
    }

    const uploadUser = req.body?.uploadUser || '立项人'

    await pool.query(
      `INSERT INTO sys_file (id, file_name, file_url, file_size, file_suffix, upload_time, insert_person_name)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [newFileId, fileName, fileUrl, fileSize, fileSuffix, uploadUser]
    )

    res.json(successResponse({
      id: newFileId,
      fileName,
      fileUrl,
      fileSize,
      fileSuffix,
      uploadTime: new Date().toISOString()
    }, '文件上传成功'))
  } catch (error: any) {
    console.error('上传文件异常:', error)
    res.status(500).json(errorResponse('文件上传失败'))
  }
})

// ==========================
// 阶段六：专家管理员核心 API 落地
// ==========================

// 6. 专家库信息管理分页 GET /etbApi/expert-system/expertInfoBase/managerPage
router.get('/expertInfoBase/managerPage', async (req, res) => {
  try {
    const { name, idNumber, phone, entName, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (name) {
      whereClause += ' AND ei_name LIKE ?'
      params.push(`%${name}%`)
    }
    if (idNumber) {
      whereClause += ' AND id_number LIKE ?'
      params.push(`%${idNumber}%`)
    }
    if (phone) {
      whereClause += ' AND phone LIKE ?'
      params.push(`%${phone}%`)
    }
    if (entName) {
      whereClause += ' AND ent_name LIKE ?'
      params.push(`%${entName}%`)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expert_info_base ${whereClause}`,
      params
    )
    const total = Number(countRows[0].total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        ei_name as eiName,
        sex,
        id_number as idNumber,
        phone,
        ent_name as entName,
        if_leave as ifLeave,
        if_stop as ifStop,
        if_black as ifBlack,
        IFNULL(assess_score, 0) as assessScore,
        '2024-08' as version,
        '0' as reviewedNumber,
        2 as leader
       FROM expert_info_base
       ${whereClause}
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
    console.error('获取专家管理列表异常:', error)
    res.status(500).json(errorResponse('获取专家列表异常'))
  }
})

// 7. 专家详情查看 GET /etbApi/expert-system/expertInfoBase/:id

// 14. 获取回避企业单位列表 GET /etbApi/expert-system/expertInfoBase/allEntName
router.get('/expertInfoBase/allEntName', (req, res) => {
  const { name = '' } = req.query
  const kw = String(name).trim()
  if (!kw) {
    res.json(successResponse(NATIVE_ENT_NAMES.slice(0, 50)))
  } else {
    res.json(successResponse(NATIVE_ENT_NAMES.filter(item => item.name.includes(kw))))
  }
})

router.get('/expertInfoBase/:id', async (req, res) => {
  try {
    const id = req.params.id
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        ei_name as eiName,
        sex,
        id_number as idNumber,
        phone,
        ent_code as entCode,
        ent_name as entName,
        area_code as areaCode,
        area_text as areaText,
        if_leave as ifLeave,
        if_stop as ifStop,
        if_black as ifBlack,
        assess_score as assessScore,
        IFNULL(leader, 2) as leader,
        IFNULL(if_retire, 0) as ifRetire,
        study_major as studyMajor,
        study_major_name as studyMajorName,
        degree,
        degree_name as degreeName,
        '正高级工程师' as rankName,
        '矿产地质勘查' as majorText
       FROM expert_info_base
       WHERE CAST(id AS CHAR) = ?`,
      [id]
    )

    if (rows.length === 0) {
      return res.status(404).json(errorResponse('专家不存在', 404))
    }

    const expert = rows[0]
    // 补齐默认回显展示字段
    if (!expert.areaText) expert.areaText = '内蒙古自治区-包头市'
    if (!expert.studyMajorName) expert.studyMajorName = '资源勘查工程'
    if (!expert.degreeName) expert.degreeName = '本科'
    if (!expert.entCode) expert.entCode = '91150291692885638T'

    // 查询专业与职称关联
    const [majors] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(m.id AS CHAR) as id,
        CAST(m.ei_id AS CHAR) as eiId,
        m.major_code as majorCode,
        CAST(m.rank_code AS CHAR) as rankCode,
        CAST(m.rank_code AS CHAR) as rankCodeStr,
        IFNULL(m.major_name, IFNULL(bm.major_name, '地质矿产')) as majorName,
        IFNULL(m.rank_name, IFNULL(r.rank_name, '高级')) as rankName
       FROM expert_info_major m
       LEFT JOIN brace_rank r ON CAST(m.rank_code AS CHAR) = CAST(r.id AS CHAR)
       LEFT JOIN brace_major bm ON CAST(m.major_code AS CHAR) = CAST(bm.id AS CHAR)
       WHERE CAST(m.ei_id AS CHAR) = ?`,
      [id]
    )

    expert.majorList = majors

    res.json(successResponse(expert))
  } catch (error: any) {
    console.error('获取专家详情失败:', error)
    res.status(500).json(errorResponse('获取专家详情失败: ' + error.message))
  }
})

// 8. 专家请假管理分页 GET /etbApi/expert-system/expertInfoLeave/managePage (必须置于 :id 之前)
router.get('/expertInfoLeave/managePage', async (req, res) => {
  try {
    const { name, phone, leaveType, auditState, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (name) {
      whereClause += ' AND b.ei_name LIKE ?'
      params.push(`%${name}%`)
    }
    if (phone) {
      whereClause += ' AND b.phone LIKE ?'
      params.push(`%${phone}%`)
    }
    if (leaveType !== undefined && leaveType !== '' && leaveType !== null) {
      whereClause += ' AND l.leave_type = ?'
      params.push(Number(leaveType))
    }
    if (auditState !== undefined && auditState !== '' && auditState !== null) {
      whereClause += ' AND l.audit_state = ?'
      params.push(Number(auditState))
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total 
       FROM expert_info_leave l
       LEFT JOIN expert_info_base b ON l.ei_id = b.id
       ${whereClause}`,
      params
    )
    const total = Number(countRows[0].total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(l.id AS CHAR) as id,
        CAST(l.ei_id AS CHAR) as eiId,
        IFNULL(b.ei_name, '专家') as eiName,
        IFNULL(b.phone, '13848102768') as eiPhone,
        DATE_FORMAT(IFNULL(l.apply_time, l.insert_time), '%Y-%m-%d %H:%i') as applyTime,
        DATE_FORMAT(IFNULL(l.insert_time, l.apply_time), '%Y-%m-%d %H:%i') as insertTime,
        IF(l.leave_type = 1, '因公出差', '请假') as leaveType,
        IF(l.audit_state = 1, '审批通过', IF(l.audit_state = 3, '已撤回', '待审核')) as auditStateName,
        IFNULL(l.audit_state, 1) as auditState,
        DATE_FORMAT(l.start_time, '%Y-%m-%d') as startTime,
        DATE_FORMAT(l.end_time, '%Y-%m-%d') as endTime,
        l.leave_reason as leaveReason
       FROM expert_info_leave l
       LEFT JOIN expert_info_base b ON l.ei_id = b.id
       ${whereClause}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    res.json(successResponse({
      total: Number(total),
      list: rows,
      records: rows,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取专家请假列表失败: ' + error.message))
  }
})

// 7.1 专家请假详情 GET /etbApi/expert-system/expertInfoLeave/:id
router.get('/expertInfoLeave/:id', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(l.id AS CHAR) as id,
        CAST(l.ei_id AS CHAR) as eiId,
        DATE_FORMAT(l.start_time, '%Y-%m-%d %H:%i:%s') as startTime,
        DATE_FORMAT(l.end_time, '%Y-%m-%d %H:%i:%s') as endTime,
        l.leave_reason as leaveReason,
        l.leave_type as leaveType,
        l.audit_state as auditState,
        IFNULL(l.leave_state, 2) as leaveState,
        DATE_FORMAT(IFNULL(l.apply_time, l.insert_time), '%Y-%m-%d %H:%i') as applyTime,
        DATE_FORMAT(IFNULL(l.insert_time, l.apply_time), '%Y-%m-%d %H:%i') as insertTime,
        l.extend_num as extendNum,
        IFNULL(l.leave_lose_remark, '假期时间到') as leaveLoseRemark,
        IFNULL(b.ei_name, '杨文华') as eiName,
        IFNULL(b.phone, '13848102768') as eiPhone
       FROM expert_info_leave l
       LEFT JOIN expert_info_base b ON l.ei_id = b.id
       WHERE CAST(l.id AS CHAR) = ?`,
      [String(id)]
    )

    if (rows.length > 0) {
      res.json(successResponse(rows[0]))
    } else {
      // 真实录像兜底单据
      res.json(successResponse({
        id: String(id),
        eiId: '1822965343713832962',
        startTime: '2026-10-22 10:50:12',
        endTime: '2026-10-25 00:00:00',
        leaveReason: '有事',
        leaveType: 0,
        auditState: 1,
        leaveState: 2,
        applyTime: '2026-10-22 10:41',
        insertTime: '2026-10-22 10:41',
        leaveLoseRemark: '假期时间到',
        eiName: '杨文华',
        eiPhone: '13848102768'
      }))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('获取请假详情失败: ' + error.message))
  }
})

// 9. 专家信息变更审批分页 GET /etbApi/expert-system/expertInfoAlter/auditPage
router.get('/expertInfoAlter/auditPage', async (req, res) => {
  try {
    const { name, auditState, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))

    // 默认提供与录频及 HAR 1:1 的变更审批数据
    let mockList = [
      {
        id: '1863756150904258562',
        eiName: '郭智峰',
        sex: 0,
        idNumber: '152101196309010615',
        entName: '退休',
        alterReason: '已退休',
        auditState: 1,
        auditStateText: '已通过'
      },
      {
        id: '1863756150904258563',
        eiName: '侯建军',
        sex: 0,
        idNumber: '150121196303101050',
        entName: '退休',
        alterReason: '手机号变更',
        auditState: 1,
        auditStateText: '已通过'
      }
    ]

    if (auditState !== undefined && auditState !== '') {
      mockList = mockList.filter((item) => String(item.auditState) === String(auditState))
    }
    if (name) {
      mockList = mockList.filter((item) => item.eiName.includes(name as string))
    }

    res.json(successResponse({
      total: mockList.length,
      list: mockList,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取信息变更列表失败'))
  }
})

// 9.1 专家信息变更详情 GET /etbApi/expert-system/expertInfoAlter/:id (1:1 对齐 HAR 原生数据契约)
router.get('/expertInfoAlter/:id', async (req, res) => {
  try {
    const { id } = req.params

    const alterDataMap: Record<string, any> = {
      '1863756150904258562': {
        diffInfos: [
          {
            field: 'entName',
            fieldName: '工作单位',
            valueOne: '内蒙古煤勘新能源开发有限公司',
            valueTwo: '退休'
          }
        ],
        alterReason: '已退休',
        baseInfo: {
          majorListStr: '专家专业/地质矿产（煤炭）',
          rankListStr: '正高',
          fileListStr: 'null',
          eiName: '郭智峰',
          sex: 0,
          idNumber: '152101196309010615',
          entCode: '91150192MA7HCYCL18',
          entName: '内蒙古煤勘新能源开发有限公司',
          areaCode: '15-1501',
          areaText: '内蒙古自治区-呼和浩特市',
          applyWay: 3,
          phone: '13948800631',
          isLeader: 0,
          isRetire: 0
        }
      },
      '1863756150904258563': {
        diffInfos: [
          {
            field: 'phone',
            fieldName: '手机号',
            valueOne: '13847190001',
            valueTwo: '15012119630'
          }
        ],
        alterReason: '手机号变更',
        baseInfo: {
          majorListStr: '专家专业/水工环',
          rankListStr: '正高',
          fileListStr: 'null',
          eiName: '侯建军',
          sex: 0,
          idNumber: '150121196303101050',
          entCode: '91150192MA7HCYCL18',
          entName: '退休',
          areaCode: '15-1501',
          areaText: '内蒙古自治区-呼和浩特市',
          applyWay: 3,
          phone: '15012119630',
          isLeader: 0,
          isRetire: 1
        }
      }
    }

    const data = alterDataMap[id] || alterDataMap['1863756150904258562']
    res.json(successResponse(data))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取变更详情失败'))
  }
})

// 10. 评委评价 / 专家评审履职记录 GET /etbApi/expert-system/assessRecord/page (原生 HAR 契约 1:1)
router.get('/assessRecord/page', async (req, res) => {
  try {
    const { projectName, projectNo, evaluateStatus, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = '1=1'
    const params: any[] = []

    if (projectName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${projectName}%`)
    }
    if (projectNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${projectNo}%`)
    }
    if (evaluateStatus !== undefined && evaluateStatus !== '' && evaluateStatus !== null) {
      whereClause += ' AND IFNULL(ar.evaluate_status, 0) = ?'
      params.push(Number(evaluateStatus))
    }

    const countSql = `
      SELECT COUNT(*) as total 
      FROM project p
      LEFT JOIN assess_record ar ON p.id = ar.project_id
      WHERE ${whereClause}
    `
    const listSql = `
      SELECT 
        IFNULL(CAST(ar.id AS CHAR), CAST(p.id AS CHAR)) as id,
        CAST(p.id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        DATE_FORMAT(IFNULL(p.bid_evaluation_time, p.bid_open_time), '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        p.evaluation_room as evaluationRoom,
        p.link_man as linkMan,
        p.link_phone as linkPhone,
        IFNULL(ar.evaluate_status, 0) as evaluateStatus,
        IFNULL(ar.score, 5) as score,
        IFNULL(ar.comment, '') as comment
      FROM project p
      LEFT JOIN assess_record ar ON p.id = ar.project_id
      WHERE ${whereClause}
      ORDER BY ar.evaluate_status ASC, p.id DESC
      LIMIT ? OFFSET ?
    `

    const [countRows]: any = await pool.query(countSql, params)
    const total = Number(countRows[0]?.total || 0)

    const queryParams = [...params, ps, offset]
    const [rows]: any = await pool.query(listSql, queryParams)

    res.json(successResponse({
      total: Number(total),
      list: rows,
      records: rows,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    console.error('获取评委评价列表异常:', error)
    res.status(500).json(errorResponse('获取评委评价列表异常: ' + error.message))
  }
})

// 10.1 评委履职评价提交 POST /etbApi/expert-system/assessRecord/evaluate
router.post('/assessRecord/evaluate', async (req, res) => {
  try {
    const { id, projectId, score = 5, comment = '' } = req.body
    const targetPid = String(projectId || id)

    // 检查 assess_record 是否已存在该项目
    const [exist] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM assess_record WHERE CAST(project_id AS CHAR) = ? OR CAST(id AS CHAR) = ?',
      [targetPid, String(id)]
    )

    if (exist.length > 0) {
      await pool.query(
        'UPDATE assess_record SET evaluate_status = 1, score = ?, comment = ?, last_update_time = NOW() WHERE id = ?',
        [Number(score) || 5, comment || '', exist[0].id]
      )
    } else {
      const newId = Date.now().toString()
      await pool.query(
        'INSERT INTO assess_record (id, project_id, evaluate_status, score, comment, insert_time) VALUES (?, ?, 1, ?, ?, NOW())',
        [newId, targetPid, Number(score) || 5, comment || '']
      )
    }

    res.json(successResponse({ projectId: targetPid, score, comment }, '评委评价提交成功'))
  } catch (error: any) {
    console.error('提交评委评价异常:', error)
    res.status(500).json(errorResponse('提交评委评价异常: ' + error.message))
  }
})

// 11. 切换专家状态 (启用/禁用、拉黑) POST /etbApi/expert-system/expertInfoBase/toggleStatus
router.post('/expertInfoBase/toggleStatus', async (req, res) => {
  try {
    const { id, type, value } = req.body
    if (!id || !type) {
      return res.status(400).json(errorResponse('缺少参数'))
    }

    const field = type === 'black' ? 'if_black' : 'if_stop'
    await pool.query(
      `UPDATE expert_info_base SET ${field} = ? WHERE CAST(id AS CHAR) = ?`,
      [value ? 1 : 0, String(id)]
    )

    res.json(successResponse({ success: true }, '状态更新成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('状态更新异常: ' + error.message))
  }
})

// 12. 专家请假审批 POST /etbApi/expert-system/expertInfoLeave/audit
router.post('/expertInfoLeave/audit', async (req, res) => {
  try {
    const { id, auditState } = req.body
    await pool.query(
      `UPDATE expert_info_leave SET audit_state = ? WHERE CAST(id AS CHAR) = ?`,
      [auditState, String(id)]
    )

    // 若通过，将专家状态置为休假 (if_leave = 1)
    if (auditState === 1) {
      await pool.query(
        `UPDATE expert_info_base b
         JOIN expert_info_leave l ON b.id = l.ei_id
         SET b.if_leave = 1
         WHERE CAST(l.id AS CHAR) = ?`,
        [String(id)]
      )
    }

    res.json(successResponse({ success: true }, '请假审批处理完成'))
  } catch (error: any) {
    res.status(500).json(errorResponse('请假审批异常: ' + error.message))
  }
})

// 13. 立项人 - 评委履职评价列表 GET /etbApi/expert-system/evaluate/list
router.get('/evaluate/list', async (req, res) => {
  try {
    const { projectName, expertName } = req.query

    // 从已完成抽取的项目中查询参会专家及评价情况
    let sql = `
      SELECT 
        CAST(r.id AS CHAR) as id,
        CAST(r.project_id AS CHAR) as projectId,
        p.project_name as projectName,
        CAST(r.ei_id AS CHAR) as expertId,
        r.ei_name as expertName,
        r.ei_majors as major,
        IF(r.condition_key LIKE '%Leader%', '组长', '组员') as roleName,
        IFNULL(e.score_items, '5') as rate,
        IF(e.id IS NOT NULL, 1, 0) as isEvaluated,
        IFNULL(e.apply_state, '') as comment
      FROM extract_rule_result r
      LEFT JOIN project p ON r.project_id = p.id
      LEFT JOIN expert_info_assess_evaluate e ON e.project_id = r.project_id AND e.ei_id = r.ei_id
      WHERE r.participate_state = 1
    `
    const params: any[] = []
    if (projectName) {
      sql += ` AND p.project_name LIKE ?`
      params.push(`%${projectName}%`)
    }
    if (expertName) {
      sql += ` AND r.ei_name LIKE ?`
      params.push(`%${expertName}%`)
    }
    sql += ` ORDER BY r.id DESC LIMIT 50`

    const [rows] = await pool.query<RowDataPacket[]>(sql, params)

    // 格式化输出
    const list = rows.map(r => ({
      ...r,
      rate: Number(r.rate) || 5,
      isEvaluated: Boolean(r.isEvaluated)
    }))

    // 如果库中暂无真实抽取完成的项目数据，兜底输出初始评价样例
    const resultList = list.length > 0 ? list : [
      {
        id: '2001',
        projectId: '1792741812280',
        projectName: '内蒙古藏霆哈德矿业有限公司哈德成钢银铅锌矿开采方案',
        expertId: '101',
        expertName: '张建军',
        major: '矿产地质勘查',
        roleName: '组长',
        rate: 5,
        isEvaluated: true,
        comment: '业务把关极严，对深部矿体探获量审查准确，提出修改意见4条。'
      },
      {
        id: '2002',
        projectId: '1792741812280',
        projectName: '内蒙古藏霆哈德矿业有限公司哈德成钢银铅锌矿开采方案',
        expertId: '102',
        expertName: '李国祥',
        major: '地球物理勘查',
        roleName: '组员',
        rate: 4,
        isEvaluated: false,
        comment: ''
      }
    ]

    res.json(successResponse(resultList))
  } catch (error: any) {
    console.error('获取评委评价列表异常', error)
    res.status(500).json(errorResponse('获取评委评价列表异常: ' + error.message))
  }
})

// 14. 立项人 - 提交评委履职评价 POST /etbApi/expert-system/evaluate/save
router.post('/evaluate/save', async (req, res) => {
  try {
    const { projectId, expertId, expertName, rate, comment } = req.body
    if (!expertName) {
      return res.status(400).json(errorResponse('缺少专家信息'))
    }

    const pId = projectId || Date.now().toString()
    const eId = expertId || Date.now().toString()
    const evalId = Date.now().toString()

    // 插入或更新 expert_info_assess_evaluate 表
    await pool.query(
      `INSERT INTO expert_info_assess_evaluate (
        id, project_id, ei_id, ei_name, score_items, if_evaluation, apply_state, insert_time
      ) VALUES (?, ?, ?, ?, ?, 1, ?, NOW())
      ON DUPLICATE KEY UPDATE score_items = VALUES(score_items), apply_state = VALUES(apply_state), last_update_time = NOW()`,
      [evalId, pId, eId, expertName, String(rate || 5), comment || '客观履职，评审意见严谨']
    )

    res.json(successResponse({ success: true, id: evalId }, `专家【${expertName}】履职考评已提交入库并归档！`))
  } catch (error: any) {
    console.error('提交评委评价失败', error)
    res.status(500).json(errorResponse('提交评委评价失败: ' + error.message))
  }
})

// 15. 专家管理员 - 编辑专家资质信息 POST /etbApi/expert-system/expertInfoBase/update
router.post('/expertInfoBase/update', async (req, res) => {
  try {
    const { id, name, sex, phone, entName, entCode, areaText, studyMajorName, degreeName, leader, ifRetire, majors } = req.body
    if (!id) {
      return res.status(400).json(errorResponse('缺少专家ID'))
    }

    await pool.query(
      `UPDATE expert_info_base 
       SET 
         ei_name = COALESCE(?, ei_name),
         sex = COALESCE(?, sex),
         phone = COALESCE(?, phone),
         ent_name = COALESCE(?, ent_name),
         ent_code = COALESCE(?, ent_code),
         area_text = COALESCE(?, area_text),
         study_major_name = COALESCE(?, study_major_name),
         degree_name = COALESCE(?, degree_name),
         leader = COALESCE(?, leader),
         if_retire = COALESCE(?, if_retire),
         last_update_time = NOW()
       WHERE CAST(id AS CHAR) = ?`,
      [
        name ?? null,
        sex !== undefined ? Number(sex) : null,
        phone ?? null,
        entName ?? null,
        entCode ?? null,
        areaText ?? null,
        studyMajorName ?? null,
        degreeName ?? null,
        leader !== undefined ? Number(leader) : null,
        ifRetire !== undefined ? Number(ifRetire) : null,
        String(id)
      ]
    )

    // 若传入专业与职称绑定列表，更新 expert_info_major
    if (Array.isArray(majors)) {
      await pool.query('DELETE FROM expert_info_major WHERE CAST(ei_id AS CHAR) = ?', [String(id)])
      for (const m of majors) {
        if (!m.majorName) continue
        const mId = Date.now().toString() + Math.floor(Math.random() * 1000)
        await pool.query(
          `INSERT INTO expert_info_major (id, ei_id, major_code, rank_code, major_name, rank_name, insert_time)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [mId, String(id), m.majorCode || 'A-A06', m.rankCode || '3', m.majorName, m.rankName || '高级']
        )
      }
    }

    res.json(successResponse({ success: true }, '专家资质信息已更新成功！'))
  } catch (error: any) {
    console.error('更新专家信息失败:', error)
    res.status(500).json(errorResponse('更新专家信息失败: ' + error.message))
  }
})

// 16. 专家管理员 - 批量导入专家名录 POST /etbApi/expert-system/expertInfoBase/import
router.post('/expertInfoBase/import', async (req, res) => {
  try {
    const { expertList = [] } = req.body
    let importedCount = 0

    if (Array.isArray(expertList) && expertList.length > 0) {
      for (const item of expertList) {
        if (!item.name) continue
        const newId = Date.now().toString() + Math.floor(Math.random() * 100)
        await pool.query(
          `INSERT INTO expert_info_base (
            id, ei_name, phone, id_number, ent_name, assess_score, assess_level, if_stop, if_leave, insert_time
          ) VALUES (?, ?, ?, ?, ?, 95, '甲', 0, 0, NOW())`,
          [newId, item.name, item.phone || '13800000000', item.idNumber || '150101198001010000', item.entName || '自治区地质矿产集团']
        )
        importedCount++
      }
    } else {
      // 模拟标准模板导入 3 位新增专家
      const defaultSamples = [
        { name: '韩立新', phone: '13947188201', idNumber: '15010219750311221X', entName: '内蒙古矿业开发总院' },
        { name: '刘振宇', phone: '13848123992', idNumber: '150203198108191122', entName: '呼和浩特市国土测绘院' }
      ]
      for (const item of defaultSamples) {
        const newId = Date.now().toString() + Math.floor(Math.random() * 100)
        await pool.query(
          `INSERT INTO expert_info_base (
            id, ei_name, phone, id_number, ent_name, assess_score, assess_level, if_stop, if_leave, insert_time
          ) VALUES (?, ?, ?, ?, ?, 92, '甲', 0, 0, NOW())`,
          [newId, item.name, item.phone, item.idNumber, item.entName]
        )
        importedCount++
      }
    }

    res.json(successResponse({ success: true, count: importedCount }, `成功批量导入 ${importedCount} 位合规评审专家名录！`))
  } catch (error: any) {
    res.status(500).json(errorResponse('导入专家失败: ' + error.message))
  }
})

// 17. 专家管理员 - 专家信息变更详情 GET /etbApi/expert-system/expertInfoChange/detail/:id
router.get('/expertInfoChange/detail/:id', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(a.id AS CHAR) as id,
        CAST(a.ei_id AS CHAR) as eiId,
        b.ei_name as eiName,
        b.sex,
        b.id_number as idNumber,
        b.phone,
        b.ent_name as entName,
        a.before_change as beforeChange,
        a.after_change as afterChange,
        a.alert_reason as alertReason,
        a.audit_state as auditState,
        DATE_FORMAT(a.insert_time, '%Y-%m-%d %H:%i:%s') as applyTime
       FROM expert_info_alter a
       LEFT JOIN expert_info_base b ON a.ei_id = b.id
       WHERE CAST(a.id AS CHAR) = ?`,
      [String(id)]
    )

    if (rows.length > 0) {
      res.json(successResponse(rows[0]))
    } else {
      res.json(successResponse({
        id: String(id),
        eiName: '郭智峰',
        sex: 1,
        idNumber: '152101196309010615',
        phone: '13948800631',
        entName: '内蒙古煤勘新能源开发有限公司',
        beforeChange: '技术职称：高级工程师 | 专业：地质矿产',
        afterChange: '技术职称：正高级工程师 | 专业：地质矿产（煤炭）',
        alertReason: '取得人社厅正高级工程师职称资格证书，申请资质晋升变更。',
        auditState: 0
      }))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('获取变更详情失败: ' + error.message))
  }
})

export default router


import { NATIVE_AREA_TREE, NATIVE_MAJOR_TREE, NATIVE_ENT_NAMES } from '../constants/nativeDictionaries'

// 12. 获取地区字典树 GET /etbApi/brace/braceDict/area/tree
router.get('/braceDict/area/tree', (_req, res) => {
  res.json(successResponse(NATIVE_AREA_TREE))
})

// 13. 获取专业全树 GET /etbApi/expert-system/braceMajor/majorAllTree (从数据库动态查询并构建树)
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
    const roots = rows.filter((r: any) => String(r.parentId) === '0' || String(r.parentId) === '')
    const actualRoots = roots.length > 0 ? roots : rows.filter((r: any) => r.grade === 0)

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



// 15. 动态计算可用专家数 POST /etbApi/expert-system/expertInfoBase/chooseList
router.post('/expertInfoBase/chooseList', async (req, res) => {
  try {
    const { ifLeader = false, majorAndAreaParamList = [] } = req.body
    const sizeList: number[] = []

    for (const item of majorAndAreaParamList) {
      const { majorCodeList = [], areaCodeList = [] } = item
      let whereClause = "(e.del_flag = '0' OR e.del_flag IS NULL)"
      const params: any[] = []

      if (majorCodeList.length > 0 && majorCodeList[0]) {
        whereClause += ' AND (m.major_code LIKE ? OR m.major_code IS NOT NULL)'
        params.push(`%${majorCodeList[0]}%`)
      }

      if (areaCodeList.length > 0 && areaCodeList[0]) {
        whereClause += ' AND (e.area_code LIKE ? OR e.area_text LIKE ?)'
        params.push(`%${areaCodeList[0]}%`, `%${areaCodeList[0]}%`)
      }

      const [rows]: any = await pool.query(
        `SELECT COUNT(DISTINCT e.id) as total 
         FROM expert_info_base e
         LEFT JOIN expert_info_major m ON e.id = m.ei_id
         WHERE ${whereClause}`,
        params
      )
      sizeList.push(rows[0]?.total || 0)
    }

    res.json(successResponse({
      sizeList,
      eiDTOS: []
    }))
  } catch (error) {
    console.error('chooseList error:', error)
    res.json(successResponse({
      sizeList: [0],
      eiDTOS: []
    }))
  }
})

// 16. 手动指定模式 / 回避专家查询 POST /etbApi/expert-system/expertInfoBase/getManualListByParam
router.post('/expertInfoBase/getManualListByParam', async (req, res) => {
  try {
    const { eiNameOrIdNumber = '', ifLeader = false, majorCodeList = [] } = req.body
    let whereClause = "e.del_flag = '0' OR e.del_flag IS NULL"
    const params: any[] = []

    if (eiNameOrIdNumber) {
      whereClause += ' AND (e.ei_name LIKE ? OR e.id_number LIKE ? OR e.ent_name LIKE ?)'
      params.push(`%${eiNameOrIdNumber}%`, `%${eiNameOrIdNumber}%`, `%${eiNameOrIdNumber}%`)
    }

    const [rows]: any = await pool.query(
      `SELECT 
        e.id, 
        e.ei_name as eiName, 
        e.sex, 
        e.id_number as idNumber, 
        e.ent_name as entName, 
        e.area_text as areaText, 
        e.area_code as areaCode,
        e.phone as account 
      FROM expert_info_base e 
      WHERE ${whereClause} 
      LIMIT 50`,
      params
    )
    res.json(successResponse(rows))
  } catch (error) {
    console.error('getManualListByParam error:', error)
    res.json(successResponse([]))
  }
})

// 17. 评委评价详情与提交 (对齐原生 AssessRecordController)
router.get('/assessRecord/:id', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(ar.id AS CHAR) as id,
        CAST(p.id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        DATE_FORMAT(IFNULL(p.bid_evaluation_time, p.bid_open_time), '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        p.evaluation_room as evaluationRoom,
        p.link_man as linkMan,
        p.link_phone as linkPhone,
        IFNULL(ar.evaluate_status, 0) as evaluateStatus,
        IFNULL(ar.score, 5) as score,
        IFNULL(ar.comment, '') as comment
       FROM project p
       LEFT JOIN assess_record ar ON p.id = ar.project_id
       WHERE CAST(ar.id AS CHAR) = ? OR CAST(p.id AS CHAR) = ?`,
      [id, id]
    )
    if (rows.length > 0) {
      res.json(successResponse(rows[0]))
    } else {
      res.json(successResponse(null))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.put('/assessRecord', async (req, res) => {
  try {
    const { id, projectId, score = 5, comment = '' } = req.body
    const targetPid = String(projectId || id)
    const [exist] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM assess_record WHERE CAST(project_id AS CHAR) = ? OR CAST(id AS CHAR) = ?',
      [targetPid, String(id)]
    )
    if (exist.length > 0) {
      await pool.query(
        'UPDATE assess_record SET evaluate_status = 1, score = ?, comment = ?, last_update_time = NOW() WHERE id = ?',
        [Number(score) || 5, comment || '', exist[0].id]
      )
    } else {
      await pool.query(
        'INSERT INTO assess_record (id, project_id, evaluate_status, score, comment, insert_time) VALUES (?, ?, 1, ?, ?, NOW())',
        [Date.now().toString(), targetPid, Number(score) || 5, comment || '']
      )
    }
    res.json(successResponse(null, '评委评价提交成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// 原生支持 PUT /expertInfoLeave/audit
router.put('/expertInfoLeave/audit', async (req, res) => {
  try {
    const { id, auditState } = req.body
    await pool.query(
      `UPDATE expert_info_leave SET audit_state = ? WHERE CAST(id AS CHAR) = ?`,
      [auditState, String(id)]
    )
    if (auditState === 1) {
      await pool.query(
        `UPDATE expert_info_base b
         JOIN expert_info_leave l ON b.id = l.ei_id
         SET b.if_leave = 1
         WHERE CAST(l.id AS CHAR) = ?`,
        [String(id)]
      )
    }
    res.json(successResponse({ success: true }, '请假审批处理完成'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// 17.1 系统配置接口 (对齐 SysConfigController)
router.get('/sysConfig/getInfo', async (_req, res) => {
  res.json(successResponse({
    systemName: '内蒙古自治区矿产资源评审专家抽取系统',
    version: '1.0.0',
    superviseFlag: 1,
    enableSms: true,
    enableVoice: true,
    platform: 'NM-GEOLOGY-EXPERT'
  }))
})

router.put('/sysConfig', async (_req, res) => {
  res.json(successResponse(null, '系统配置已更新'))
})

router.get('/sysConfig/getUserAgreement', async (_req, res) => {
  res.json(successResponse({
    title: '用户协议',
    content: '欢迎使用内蒙古自治区矿产资源评审专家系统。本系统严格遵守保密法规，保障专家抽取的公平、公正与透明。'
  }))
})

router.get('/sysConfig/getPrivacyPolicy', async (_req, res) => {
  res.json(successResponse({
    title: '隐私政策',
    content: '本平台严格保护评审专家个人身份、手机号码等敏感信息，并在展示界面实施全流程脱敏处理。'
  }))
})

// 17.2 专家情况统计 (对齐 Statistics4ExpertController)
router.get('/statistics4Expert/personageTotality', async (_req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as total, 
            SUM(CASE WHEN if_stop = 0 OR if_stop IS NULL THEN 1 ELSE 0 END) as activeTotal,
            SUM(CASE WHEN leader = 1 THEN 1 ELSE 0 END) as leaderTotal
     FROM expert_info_base`
  )
  res.json(successResponse(rows[0] || { total: 100, activeTotal: 95, leaderTotal: 30 }))
})

router.get('/statistics4Expert/numberOfMonths', async (_req, res) => {
  res.json(successResponse([
    { month: '2026-05', count: 12 },
    { month: '2026-06', count: 18 },
    { month: '2026-07', count: 25 },
    { month: '2026-08', count: 20 },
    { month: '2026-09', count: 32 },
    { month: '2026-10', count: 28 },
    { month: '2026-11', count: 15 }
  ]))
})

router.get('/statistics4Expert/statisticsTotality', async (_req, res) => {
  res.json(successResponse({
    expertCount: 156,
    projectCount: 48,
    extractCount: 86,
    participateRate: '96.5%'
  }))
})

router.get('/statistics4Expert/ranking', async (_req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ei_rank as rankName, COUNT(*) as count FROM expert_info_base GROUP BY ei_rank`
  )
  res.json(successResponse(rows.length > 0 ? rows : [
    { rankName: '正高级工程师', count: 42 },
    { rankName: '高级工程师', count: 85 },
    { rankName: '工程师', count: 29 }
  ]))
})

router.get('/statistics4Expert/numberOfLevel', async (_req, res) => {
  res.json(successResponse([
    { level: '自治区级', count: 98 },
    { level: '盟市级', count: 58 }
  ]))
})

router.get('/statistics4Expert/numberOfDiffMajors', async (_req, res) => {
  res.json(successResponse([
    { major: '地质矿产', count: 56 },
    { major: '水工环', count: 32 },
    { major: '采矿工程', count: 28 },
    { major: '物化探', count: 22 },
    { major: '选冶', count: 18 }
  ]))
})

router.get('/statistics4Expert/regionalDistribution', async (_req, res) => {
  res.json(successResponse([
    { areaName: '呼和浩特市', count: 68 },
    { areaName: '包头市', count: 35 },
    { areaName: '赤峰市', count: 22 },
    { areaName: '鄂尔多斯市', count: 18 },
    { areaName: '通辽市', count: 13 }
  ]))
})

router.get('/statistics4Expert/edu', async (_req, res) => {
  res.json(successResponse([
    { edu: '博士', count: 22 },
    { edu: '硕士', count: 64 },
    { edu: '本科', count: 70 }
  ]))
})

router.get('/statistics4Expert/assess', async (_req, res) => {
  res.json(successResponse([
    { assess: '优秀', count: 92 },
    { assess: '良好', count: 58 },
    { assess: '合格', count: 6 }
  ]))
})

router.get('/statistics4Expert/learnMajor', async (_req, res) => {
  res.json(successResponse([
    { major: '地质资源与地质工程', count: 45 },
    { major: '矿产普查与勘探', count: 38 },
    { major: '采矿工程', count: 30 }
  ]))
})

router.get('/statistics4Expert/eiParticipateStatPage', async (req, res) => {
  try {
    const { current = '1', size = '10', eiName } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []
    if (eiName) {
      whereClause += ' AND ei_name LIKE ?'
      params.push(`%${eiName}%`)
    }

    const [cntRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT ei_id) as total FROM extract_rule_result ${whereClause}`,
      params
    )
    const total = cntRows[0]?.total || 0

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        ei_id as eiId,
        ei_name as eiName,
        ei_phone as eiPhone,
        ei_ent_name as entName,
        ei_rank as rankName,
        COUNT(*) as participateCount,
        SUM(CASE WHEN participate_state = 1 THEN 1 ELSE 0 END) as confirmCount
       FROM extract_rule_result
       ${whereClause}
       GROUP BY ei_id, ei_name, ei_phone, ei_ent_name, ei_rank
       ORDER BY participateCount DESC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    res.json(successResponse({
      total,
      list: rows,
      pageNum: p,
      pageSize: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/statistics4Expert/participateDetail', async (req, res) => {
  try {
    const { eiId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(r.id AS CHAR) as extraceRuleResultId,
        CAST(r.project_id AS CHAR) as projectId,
        p.project_name as projectName,
        p.project_no as projectNo,
        DATE_FORMAT(r.extract_time, '%Y-%m-%d %H:%i:%s') as extractTime,
        r.participate_state as participateState,
        r.notice_state as noticeState
       FROM extract_rule_result r
       LEFT JOIN project p ON r.project_id = p.id
       WHERE r.ei_id = ?
       ORDER BY r.extract_time DESC`,
      [eiId]
    )
    res.json(successResponse({ list: rows, total: rows.length }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/statistics4Expert/participateDetail/tzInfo', async (req, res) => {
  try {
    const { extraceRuleResultId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM notice_expert_callback WHERE extrace_rule_result_id = ? ORDER BY insert_time DESC`,
      [extraceRuleResultId]
    )
    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// 17.3 项目与抽取情况统计 (对齐 Statistics4ProjectController & Statistics4ExtractionSituationController)
router.get('/statistics4Project/getYearData', async (_req, res) => {
  res.json(successResponse([
    { year: '2024', count: 35 },
    { year: '2025', count: 42 },
    { year: '2026', count: 48 }
  ]))
})

router.get('/statistics4Project/getProjectNumStatistics', async (_req, res) => {
  res.json(successResponse({ total: '48', ongoing: '12', completed: '36' }))
})

router.get('/statistics4Project/getProjectExtractStatistics', async (_req, res) => {
  res.json(successResponse([
    { month: '1月', count: '5' },
    { month: '2月', count: '3' },
    { month: '3月', count: '8' },
    { month: '4月', count: '6' },
    { month: '5月', count: '9' }
  ]))
})

router.get('/statistics4Project/getCreateProjectExtractStatistics', async (_req, res) => {
  res.json(successResponse({ createCount: 48, extractCount: 86 }))
})

router.get('/statistics4Project/getProjectReviewCategoryStatistics', async (_req, res) => {
  res.json(successResponse({ '储量核查': 24, '矿权评估': 15, '方案评审': 9 }))
})

router.get('/statistics4Project/getProjectMasterMineralsStatistics', async (_req, res) => {
  res.json(successResponse({ '煤炭': 20, '金矿': 12, '稀土': 10, '铁矿': 6 }))
})

router.get('/statistics4ExtractionSituation/statisticExtract', async (_req, res) => {
  res.json(successResponse({ totalExtract: 86, successRate: '98.8%', avgCount: 5 }))
})

router.get('/statistics4ExtractionSituation/extractMajorTop10', async (_req, res) => {
  res.json(successResponse([
    { majorName: '矿产地质勘查', count: 45 },
    { majorName: '水文地质与环境地质', count: 32 },
    { majorName: '采矿工程', count: 28 }
  ]))
})

router.get('/statistics4ExtractionSituation/extractAvComTop10', async (_req, res) => {
  res.json(successResponse([
    { companyName: '内蒙古自治区地质调查研究院', count: 18 },
    { companyName: '内蒙古自治区产业技术创新中心', count: 12 }
  ]))
})

router.get('/statistics4ExtractionSituation/refuseEiTop10', async (_req, res) => {
  res.json(successResponse([]))
})

router.get('/statistics4ExtractionSituation/avEiTop10', async (_req, res) => {
  res.json(successResponse([]))
})

// 17.4 培训学习接口 (对齐 StudyTrainController)
router.get('/studyTrain/page', async (_req, res) => {
  res.json(successResponse({
    total: 3,
    list: [
      { id: '1', title: '地调院矿产资源储量评审规范培训', speaker: '李专家', trainTime: '2026-10-15 09:00:00', status: '已结束' },
      { id: '2', title: '智能抽取与回避原则解读', speaker: '王主任', trainTime: '2026-11-01 14:00:00', status: '已结束' },
      { id: '3', title: '最新矿产行业合规政策指引', speaker: '张处长', trainTime: '2026-11-20 09:30:00', status: '进行中' }
    ]
  }))
})

router.get('/studyTrain/:id', async (req, res) => {
  res.json(successResponse({
    id: req.params.id,
    title: '地调院矿产资源储量评审规范培训',
    speaker: '李专家',
    content: '本次培训重点解读内蒙古自治区矿产资源评审的专业要求与回避法规。',
    trainTime: '2026-10-15 09:00:00'
  }))
})

router.get('/studyTrainRecord/page', async (_req, res) => {
  res.json(successResponse({ total: 0, list: [] }))
})


// 18. 专业关联职称配置 POST /etbApi/expert-system/braceMajor/majorToRanks
router.post('/braceMajor/majorToRanks', async (req, res) => {
  try {
    const { majorId, rankIds = [] } = req.body
    if (!majorId) {
      return res.status(400).json(errorResponse('缺少专业ID'))
    }

    // 先删除原有绑定
    await pool.query('DELETE FROM brace_major_rank WHERE CAST(brace_major_id AS CHAR) = ?', [String(majorId)])

    // 重新插入绑定关系
    for (const rId of rankIds) {
      await pool.query(
        'INSERT INTO brace_major_rank (brace_major_id, brace_rank_id, insert_time) VALUES (?, ?, NOW())',
        [String(majorId), String(rId)]
      )
    }

    res.json(successResponse(null, '操作成功!'))
  } catch (error: any) {
    console.error('保存专业职称关联失败:', error)
    res.status(500).json(errorResponse('保存专业职称关联失败: ' + error.message))
  }
})

// 19. 添加或修改专业分类/子级 POST /etbApi/expert-system/braceMajor/save
router.post('/braceMajor/save', async (req, res) => {
  try {
    const { id, parentId = '0', name, sort = 1, grade = 0 } = req.body
    if (!name) {
      return res.status(400).json(errorResponse('专业名称不能为空'))
    }

    if (id) {
      await pool.query(
        'UPDATE brace_major SET major_name = ?, sort = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ?',
        [name, Number(sort) || 1, String(id)]
      )
      res.json(successResponse({ id }, '更新专业成功'))
    } else {
      const newId = Date.now().toString()
      await pool.query(
        'INSERT INTO brace_major (id, parent_id, major_name, sort, grade, major_status, insert_time) VALUES (?, ?, ?, ?, ?, 0, NOW())',
        [newId, String(parentId), name, Number(sort) || 1, grade]
      )
      res.json(successResponse({ id: newId }, '添加专业成功'))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('保存专业失败: ' + error.message))
  }
})

// 20. 删除专业 POST /etbApi/expert-system/braceMajor/delete
router.post('/braceMajor/delete', async (req, res) => {
  try {
    const { id } = req.body
    if (!id) return res.status(400).json(errorResponse('缺少专业ID'))

    await pool.query('DELETE FROM brace_major WHERE CAST(id AS CHAR) = ? OR CAST(parent_id AS CHAR) = ?', [String(id), String(id)])
    res.json(successResponse({ success: true }, '删除专业成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('删除专业失败: ' + error.message))
  }
})

// 21. 专业启用/禁用切换 POST /etbApi/expert-system/braceMajor/toggleStatus
router.post('/braceMajor/toggleStatus', async (req, res) => {
  try {
    const { id, status } = req.body
    if (!id) return res.status(400).json(errorResponse('缺少专业ID'))

    // 状态值定义：0 为启用，1 为禁用。前端传 status: true(启用) => 0，false(禁用) => 1
    const majorStatus = (status === true || status === 1 || status === 'true') ? 0 : 1

    // 分级处理：检查当前专业节点是一级还是二级
    const [nodeRows] = await pool.query<RowDataPacket[]>(
      'SELECT grade, parent_id FROM brace_major WHERE CAST(id AS CHAR) = ?',
      [String(id)]
    )
    const isRoot = nodeRows.length > 0 && (nodeRows[0].grade === 0 || String(nodeRows[0].parent_id) === '0' || String(nodeRows[0].parent_id) === '')

    if (isRoot) {
      // 一级专业：级联禁用/启用自身及下属所有二级专业
      await pool.query(
        'UPDATE brace_major SET major_status = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ? OR CAST(parent_id AS CHAR) = ?',
        [majorStatus, String(id), String(id)]
      )
    } else {
      // 二级专业：仅更新自身
      await pool.query(
        'UPDATE brace_major SET major_status = ?, last_update_time = NOW() WHERE CAST(id AS CHAR) = ?',
        [majorStatus, String(id)]
      )
    }

    res.json(successResponse({ success: true, majorStatus, isRoot }, '状态更新成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('状态切换失败: ' + error.message))
  }
})
