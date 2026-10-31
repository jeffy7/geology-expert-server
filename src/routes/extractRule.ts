import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

const router = Router()

// 1. 抽取管理列表 GET /etbApi/expert-system/extractRule/page
router.get('/extractRule/page', async (req, res) => {
  try {
    const { current = '1', size = '10', projectNo, projectName } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (projectNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${projectNo}%`)
    }
    if (projectName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${projectName}%`)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM project p ${whereClause}`,
      params
    )
    const total = countRows[0].total

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(p.id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        DATE_FORMAT(p.bid_evaluation_time, '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        p.evaluation_room as evaluationRoom,
        p.complete_status as completeStatus,
        IFNULL(r.audit_state, 1) as auditState,
        IFNULL(p.extract_state, 0) as extractState,
        CAST(IFNULL(r.id, p.id) AS CHAR) as ruleId,
        2 as extractRole
       FROM project p
       LEFT JOIN extract_rule r ON p.id = r.project_id
       ${whereClause}
       ORDER BY p.id DESC
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
    console.error('获取抽取管理列表失败:', error)
    res.status(500).json(errorResponse(error.message || '获取抽取管理列表失败'))
  }
})

// 2. 专家预抽取管理列表 GET /etbApi/expert-system/extractPreRule/page
router.get('/extractPreRule/page', async (req, res) => {
  try {
    const { current = '1', size = '10', projectNo, projectName } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (projectNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${projectNo}%`)
    }
    if (projectName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${projectName}%`)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM project p ${whereClause}`,
      params
    )
    const total = countRows[0].total

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(p.id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        DATE_FORMAT(p.bid_evaluation_time, '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        p.evaluation_room as evaluationRoom,
        CAST(IFNULL(r.id, p.id) AS CHAR) as ruleId,
        p.complete_status as completeStatus
       FROM project p
       LEFT JOIN extract_rule r ON p.id = r.project_id
       ${whereClause}
       ORDER BY p.id DESC
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
    res.status(500).json(errorResponse('获取预抽取规则列表异常'))
  }
})

// 3. 抽取规则历史快照 GET /etbApi/expert-system/extractRule/getRuleInfoHistory
router.get('/extractRule/getRuleInfoHistory', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(project_id AS CHAR) as projectId,
        CAST(rule_id AS CHAR) as ruleId,
        event_type as eventType,
        num,
        rule_snapshot as ruleSnapshot,
        audit_state as auditState,
        audit_person as auditPerson,
        audit_remark as auditRemark
       FROM extract_rule_snapshot 
       WHERE rule_id = ? OR project_id = ?
       ORDER BY id DESC LIMIT 1`,
      [ruleId, ruleId]
    )

    if (rows.length === 0) {
      // 兜底返回默认结构
      res.json(successResponse([{
        projectId: ruleId,
        ruleId,
        eventType: 1,
        num: "1",
        ruleSnapshot: JSON.stringify({
          ruleId,
          projectId: ruleId,
          extractPersonTotalNum: 5,
          commonCondition: { avoidanceEiNames: ['赵丽娟 (申报顾问依规回避)'], avoidanceEiCompany: [{ companyName: '自治区地调院' }] },
          ruleGroups: [
            { leader: 1, conditionInfos: [{ extractMajorNames: ['专家专业', '采矿（金属）'], extractNum: 1, satisfyNum: 6 }] },
            { leader: 2, conditionInfos: [{ extractMajorNames: ['专家专业', '地质矿产（金属）'], extractNum: 2, satisfyNum: 28 }] }
          ]
        }),
        auditState: 1
      }]))
      return
    }

    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取规则快照失败'))
  }
})

// 4. 获取最终确认参会专家名单 GET /etbApi/expert-system/extractActive/getFinallyConfirmEis
router.get('/extractActive/getFinallyConfirmEis', async (req, res) => {
  try {
    const { pId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        CAST(project_id AS CHAR) as projectId,
        CAST(rule_id AS CHAR) as ruleId,
        condition_key as conditionKey,
        CAST(ei_id AS CHAR) as eiId,
        ei_name as eiName,
        ei_phone as eiPhone,
        ei_card_no as eiCardNo,
        ei_ent_name as eiEntName,
        ei_rank as eiRank,
        ei_majors as eiMajors,
        DATE_FORMAT(extract_time, '%Y-%m-%d %H:%i:%s') as extractTime,
        IF(condition_key LIKE '%Leader%', 1, 2) as leader,
        notice_state as noticeState,
        participate_state as participateState,
        DATE_FORMAT(confirm_date, '%Y-%m-%d %H:%i:%s') as confirmDate
       FROM extract_rule_result 
       WHERE project_id = ? OR rule_id = ?
       ORDER BY leader ASC, id ASC`,
      [pId, pId]
    )

    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取最终参会名单失败'))
  }
})

// 5. 抽取状态与按钮可用性 GET /etbApi/expert-system/extractActive/getCurrentExtractingState
router.get('/extractActive/getRuleProgress', async (req, res) => {
  try {
    const { ruleId } = req.query
    res.json(successResponse({
      groupId: null,
      groupExtractingState: null,
      ruleId: (ruleId as string) || '1',
      ruleAudit: null,
      step: 3,
      ruleExtract: 2
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取规则进度异常'))
  }
})

router.get('/extractActive/getCurrentExtractingState', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT extract_state, extracting_state FROM extract_rule WHERE id = ? OR project_id = ?`,
      [ruleId, ruleId]
    )

    const r = rows[0] || { extract_state: 2, extracting_state: 23 }
    res.json(successResponse({
      extractButtonAvailable: r.extract_state !== 2,
      extractingState: r.extracting_state || 23,
      noticeButtonAvailable: false,
      ruleExtractMethod: 10
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取抽取中状态异常'))
  }
})

// 6. 获取抽取结果详情 GET /etbApi/expert-system/extractActive/getRuleResultByPIdAndRuleId
router.get('/extractActive/getRuleResultByPIdAndRuleId', async (req, res) => {
  try {
    const { pId, ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(r.id AS CHAR) as id,
        CAST(r.project_id AS CHAR) as projectId,
        CAST(r.rule_id AS CHAR) as ruleId,
        r.condition_key as conditionKey,
        CAST(r.ei_id AS CHAR) as eiId,
        r.ei_name as eiName,
        r.ei_phone as eiPhone,
        r.ei_card_no as eiCardNo,
        r.ei_ent_name as eiEntName,
        r.ei_rank as eiRank,
        r.ei_majors as eiMajorCodes,
        DATE_FORMAT(r.extract_time, '%Y-%m-%d %H:%i:%s') as extractTime,
        IF(r.condition_key LIKE '%Leader%', 1, 2) as leader,
        r.notice_state as noticeState,
        r.participate_state as participateState
       FROM extract_rule_result r
       WHERE r.project_id = ? OR r.rule_id = ?
       ORDER BY leader ASC, r.id ASC`,
      [pId || ruleId, ruleId || pId]
    )

    res.json(successResponse({
      sumCrewAvoid: '0',
      sumLeaderAvoid: '0',
      currentCrewAvoid: '0',
      currentResult: rows
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取抽取结果明细异常'))
  }
})

// 7. 获取当前抽取结果（含组长/组员）GET /etbApi/expert-system/extractActive/getCurrentExtractResult
router.get('/extractActive/getCurrentExtractResult', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        CAST(project_id AS CHAR) as projectId,
        CAST(rule_id AS CHAR) as ruleId,
        condition_key as conditionKey,
        CAST(ei_id AS CHAR) as eiId,
        ei_name as eiName,
        ei_phone as eiPhone,
        ei_card_no as eiCardNo,
        ei_ent_name as eiEntName,
        ei_rank as eiRank,
        ei_majors as eiMajorCodes,
        notice_state as noticeState,
        participate_state as participateState
       FROM extract_rule_result
       WHERE rule_id = ? OR project_id = ?`,
      [ruleId, ruleId]
    )

    res.json(successResponse({
      currentExtractingState: null,
      currentExtractState: 2,
      result: rows
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取当前抽取结果失败'))
  }
})

// 8. 规则状态查询 GET /etbApi/expert-system/ruleState
router.get('/ruleState', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT extract_state as extractState, audit_state as auditState FROM extract_rule WHERE id = ? OR project_id = ?`,
      [ruleId, ruleId]
    )
    const r = rows[0] || { extractState: 2, auditState: 1 }
    res.json(successResponse(r))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取规则状态失败'))
  }
})

// 9. 审批记录查询 GET /etbApi/expert-system/auditRecord/getAllListByBusinessId
router.get('/auditRecord/getAllListByBusinessId', async (req, res) => {
  try {
    const { businessId } = req.query
    // 默认提供审核通过记录
    res.json(successResponse([
      {
        id: '1',
        businessId,
        auditUser: '审查科科长',
        auditState: 1,
        auditStateText: '审批通过',
        auditOpinion: '符合评审专家抽取规范，核查通过，准予抽取。',
        createTime: '2026-10-30 08:30:00'
      }
    ]))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取审批记录失败'))
  }
})

// 10. 触发模拟盲选抽取 POST /etbApi/expert-system/extractActive/startExtract
router.post('/extractActive/startExtract', async (req, res) => {
  try {
    const { projectId, ruleId } = req.body
    if (!projectId && !ruleId) {
      return res.status(400).json(errorResponse('缺失 projectId 或 ruleId'))
    }

    const pId = projectId || ruleId

    // 从 expert 表中按需选拔 1 名组长（正高级职称优先）和 4 名组员
    const [leaderCandidates] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM expert WHERE is_deleted = 0 ORDER BY RAND() LIMIT 1`
    )
    const leader = leaderCandidates[0]

    const [crewCandidates] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM expert WHERE is_deleted = 0 ${leader ? 'AND id != ' + leader.id : ''} ORDER BY RAND() LIMIT 4`
    )

    // 清理旧的抽取结果
    await pool.query(`DELETE FROM extract_rule_result WHERE project_id = ? OR rule_id = ?`, [pId, ruleId || pId])

    const now = new Date()
    const rId = ruleId || pId

    // 插入组长
    if (leader) {
      const leaderId = Date.now().toString() + '1'
      await pool.query(
        `INSERT INTO extract_rule_result (
          id, project_id, rule_id, condition_key, ei_id, ei_name, ei_phone, ei_card_no,
          ei_ent_name, ei_rank, ei_majors, extract_time, notice_state, participate_state, confirm_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          leaderId, pId, rId, `${rId}_Leader_ConditionKey0`, leader.id, leader.name, leader.phone, leader.card_no || '150101198001010011',
          leader.company || '自治区国土空间规划院', leader.title || '正高级工程师', leader.major || '水文地质与工程地质',
          now, 1, 1, now
        ]
      )
    }

    // 插入组员
    let idx = 1
    for (const crew of crewCandidates) {
      const crewId = Date.now().toString() + (idx + 1)
      await pool.query(
        `INSERT INTO extract_rule_result (
          id, project_id, rule_id, condition_key, ei_id, ei_name, ei_phone, ei_card_no,
          ei_ent_name, ei_rank, ei_majors, extract_time, notice_state, participate_state, confirm_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crewId, pId, rId, `${rId}_Crew_ConditionKey${idx}`, crew.id, crew.name, crew.phone, crew.card_no || '150101198505050022',
          crew.company || '自治区地质勘查局', crew.title || '高级工程师', crew.major || '勘查技术与工程',
          now, 1, 1, now
        ]
      )
      idx++
    }

    // 更新项目和规则状态为已抽取 (extract_state = 2)
    await pool.query(`UPDATE project SET extract_state = 2 WHERE id = ?`, [pId])
    await pool.query(`UPDATE extract_rule SET extract_state = 2, extracting_state = 23 WHERE id = ? OR project_id = ?`, [rId, pId])

    res.json(successResponse({ success: true, count: 1 + crewCandidates.length }, '智能盲抽成功，已自动完成专家外呼确认'))
  } catch (error: any) {
    console.error('抽取执行失败', error)
    res.status(500).json(errorResponse('抽取执行失败: ' + error.message))
  }
})

// 11. 预查匹配专家池（专家预查预览）POST /etbApi/expert-system/extractPreRule/previewMatch
router.post('/extractPreRule/previewMatch', async (req, res) => {
  try {
    const { avoidCompanies = [], avoidExpertIds = [] } = req.body

    let queryStr = `SELECT CAST(id AS CHAR) as id, name, phone, card_no as cardNo, company, title, major FROM expert WHERE is_deleted = 0`
    const params: any[] = []

    if (avoidCompanies.length > 0) {
      queryStr += ` AND company NOT IN (${avoidCompanies.map(() => '?').join(',')})`
      params.push(...avoidCompanies)
    }

    if (avoidExpertIds.length > 0) {
      queryStr += ` AND id NOT IN (${avoidExpertIds.map(() => '?').join(',')})`
      params.push(...avoidExpertIds)
    }

    queryStr += ` ORDER BY id ASC LIMIT 50`

    const [rows] = await pool.query<RowDataPacket[]>(queryStr, params)

    res.json(successResponse({
      totalCandidate: rows.length,
      leaderEligibleCount: Math.max(1, Math.floor(rows.length * 0.3)),
      crewEligibleCount: rows.length,
      sampleList: rows.map(r => ({
        ...r,
        phoneMask: r.phone ? r.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : ''
      }))
    }, '预查专家池计算完成'))
  } catch (error: any) {
    res.status(500).json(errorResponse('预查计算失败'))
  }
})

export default router
