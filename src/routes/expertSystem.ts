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

export default router

