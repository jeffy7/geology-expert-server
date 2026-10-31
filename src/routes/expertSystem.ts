import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

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
    const total = countRows[0].total

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

    // 格式化扩展属性，提取申报单位
    const list = rows.map(r => {
      let ext: any = {}
      try {
        ext = r.extInfo ? JSON.parse(r.extInfo) : {}
      } catch (e) {}

      return {
        ...r,
        inputOrgName: ext.inputOrgName || '内蒙古自然资源勘查开发机构',
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

    res.json(successResponse({
      ...r,
      id: String(r.id),
      avoidExpertIds,
      rule: ruleItem ? {
        totalExpertCount: ruleItem.total_expert_count,
        backupRatio: ruleItem.backup_ratio,
        leaderLevel: ruleItem.leader_level,
        leaderMajorId: ruleItem.leader_major_id,
        memberRules: ruleItem.member_rules_json ? JSON.parse(ruleItem.member_rules_json) : []
      } : null,
      inputOrgName: ext.inputOrgName || '',
      docRoom: ext.docRoom || '',
      applyReasonName: ext.applyReasonName || '',
      experimentOrgName: ext.experimentOrgName || '',
      joinUserList: ext.joinUserList || []
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '获取项目详情异常'))
  }
})

// 3. 新建或修改项目 POST /etbApi/expert-system/expert-system-project
router.post('/expert-system-project', async (req, res) => {
  try {
    const data = req.body
    const now = new Date()
    const projectNo = data.projectNo || String(Date.now())
    const extObj = {
      inputOrgName: data.inputOrgName || '',
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

// 5. 模拟文件上传 POST /etbApi/expert-system/file/upload
router.post('/file/upload', async (req, res) => {
  try {
    const newFileId = String(Date.now())
    const fileName = req.body?.fileName || `矿产储量评审报告附件_${newFileId}.pdf`
    const fakeUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'

    await pool.query(
      `INSERT INTO sys_file (id, file_name, file_url, file_size, file_suffix, upload_time, insert_person_name)
       VALUES (?, ?, ?, 4572980, 'application/pdf', NOW(), '立项人')`,
      [newFileId, fileName, fakeUrl]
    )

    res.json(successResponse({
      id: newFileId,
      fileName,
      fileUrl: fakeUrl,
      fileSize: 4572980
    }, '文件上传成功'))
  } catch (error: any) {
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
    const total = countRows[0].total

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
        ent_name as entName,
        area_text as areaText,
        if_leave as ifLeave,
        if_stop as ifStop,
        if_black as ifBlack,
        assess_score as assessScore,
        '正高级工程师' as rankName,
        '矿产地质勘查' as majorText
       FROM expert_info_base
       WHERE CAST(id AS CHAR) = ?`,
      [id]
    )

    if (rows.length === 0) {
      return res.status(404).json(errorResponse('专家不存在', 404))
    }

    res.json(successResponse(rows[0]))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取专家详情失败'))
  }
})

// 8. 专家请假管理分页 GET /etbApi/expert-system/expertInfoLeave/managePage
router.get('/expertInfoLeave/managePage', async (req, res) => {
  try {
    const { name, phone, current = '1', size = '10' } = req.query
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

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total 
       FROM expert_info_leave l
       LEFT JOIN expert_info_base b ON l.ei_id = b.id
       ${whereClause}`,
      params
    )
    const total = countRows[0].total

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(l.id AS CHAR) as id,
        CAST(l.ei_id AS CHAR) as eiId,
        IFNULL(b.ei_name, '专家') as eiName,
        IFNULL(b.phone, '13848102768') as eiPhone,
        DATE_FORMAT(IFNULL(l.apply_time, NOW()), '%Y-%m-%d %H:%i') as applyTime,
        IF(l.leave_type = 1, '因公出差', '请假') as leaveType,
        IF(l.audit_state = 1, '审批通过', '待审核') as auditStateName,
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
      total,
      list: rows,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取专家请假列表失败'))
  }
})

// 9. 专家信息变更审批分页 GET /etbApi/expert-system/expertInfoAlter/auditPage
router.get('/expertInfoAlter/auditPage', async (req, res) => {
  try {
    const { name, auditState, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))

    // 默认提供与录频及 HAR 1:1 的变更审批数据
    const mockList = [
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

// 10. 专家违规情况 / 计分情况 GET /etbApi/expert-system/assessRecord/page
router.get('/assessRecord/page', async (req, res) => {
  try {
    const { name, current = '1', size = '10' } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))

    const mockRecords = [
      {
        id: '2104408327055216641',
        eiName: '王富宽',
        sex: 0,
        idNumber: '150121195909201019',
        entName: '退休',
        assessDate: '2026-10-20',
        scoreVal: '-2分',
        category: '考勤违规',
        behavior: '评审会议迟到15分钟',
        projectName: '内蒙古某特大型矿区储量核查评审'
      }
    ]

    res.json(successResponse({
      total: mockRecords.length,
      list: mockRecords,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取计分记录异常'))
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

export default router

