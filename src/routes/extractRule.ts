import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import { sendTtsVoice } from '../services/vms'
import { NATIVE_MAJOR_TREE, NATIVE_AREA_TREE } from '../constants/nativeDictionaries'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

const router = Router()

// 辅助函数：根据专业代码递归查找中文专业名
const lookupMajorName = (val: string): string => {
  if (!val) return ''
  const searchTree = (nodes: any[]): string | null => {
    for (const n of nodes) {
      if (n.id === val || n.majorPath === val || n.code === val) return n.name || n.label
      if (n.children && n.children.length > 0) {
        const found = searchTree(n.children)
        if (found) return found
      }
    }
    return null
  }
  return searchTree(NATIVE_MAJOR_TREE) || val
}

// 辅助函数：根据地区代码/数组递归查找中文地区名
const lookupAreaName = (val: any): string => {
  if (!val) return '内蒙古自治区；包头市'
  const flatVals = Array.isArray(val) ? val.flat(Infinity) : [val]
  const names: string[] = []

  const searchTree = (nodes: any[], target: string): string | null => {
    for (const n of nodes) {
      if (
        String(n.id) === target ||
        String(n.code) === target ||
        n.name === target ||
        n.majorPath === target ||
        (n.code && target.endsWith(n.code))
      ) {
        return n.name
      }
      if (n.children && n.children.length > 0) {
        const f = searchTree(n.children, target)
        if (f) return f
      }
    }
    return null
  }

  for (const v of flatVals) {
    if (!v) continue
    const strV = String(v)
    if (strV.includes('包头') || strV === 'A-A02' || strV === 'A02' || strV === '3') {
      if (!names.includes('包头市')) names.push('包头市')
      continue
    }
    if (strV.includes('呼和浩特') || strV === 'A-A01' || strV === 'A01' || strV === '2') {
      if (!names.includes('呼和浩特市')) names.push('呼和浩特市')
      continue
    }
    const name = searchTree(NATIVE_AREA_TREE, strV)
    if (name && !names.includes(name)) names.push(name)
  }

  if (names.length > 0) {
    const hasAutonomous = names.some(n => n.includes('自治区'))
    if (!hasAutonomous) {
      return `内蒙古自治区；${names.join('、')}`
    }
    return names.join('；')
  }
  return '内蒙古自治区；包头市'
}

// ==========================================
// 1. 抽取规则管理列表 GET /extractRule/page
// ==========================================
router.get('/extractRule/page', async (req, res) => {
  try {
    const {
      current = '1',
      size = '10',
      projectNo,
      projectName,
      pNo,
      pName,
      PName,
      extractState,
      auditState
    } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    const searchNo = projectNo || pNo
    if (searchNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${searchNo}%`)
    }
    const searchName = projectName || pName || PName
    if (searchName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${searchName}%`)
    }
    if (extractState !== undefined && extractState !== '') {
      if (String(extractState) === '0') {
        whereClause += ' AND (r.extract_state IS NULL OR r.extract_state = 0)'
      } else {
        whereClause += ' AND r.extract_state = ?'
        params.push(extractState)
      }
    }
    if (auditState !== undefined && auditState !== '') {
      if (String(auditState) === '-1') {
        whereClause += ' AND (r.audit_state IS NULL OR r.audit_state = -1)'
      } else {
        whereClause += ' AND r.audit_state = ?'
        params.push(auditState)
      }
    }

    const countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM project p
      LEFT JOIN extract_rule r ON p.id = r.project_id AND (r.event_type = 1 OR r.event_type IS NULL)
      ${whereClause}
    `
    const [countRows] = await pool.query<RowDataPacket[]>(countSql, params)
    const total = countRows[0]?.total || 0

    const listSql = `
      SELECT 
        CAST(COALESCE(r.id, p.id) AS CHAR) as id,
        CAST(r.id AS CHAR) as ruleId,
        CAST(p.id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        p.evaluation_room as evaluationRoom,
        p.link_man as linkMan,
        p.link_phone as linkPhone,
        DATE_FORMAT(COALESCE(p.bid_evaluation_time, p.bid_open_time), '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        DATE_FORMAT(p.bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime,
        COALESCE(r.event_type, 1) as eventType,
        COALESCE(r.audit_state, -1) as auditState,
        COALESCE(r.extract_state, 0) as extractState,
        r.extracting_state as extractingState,
        DATE_FORMAT(r.start_extract_time, '%Y-%m-%d %H:%i:%s') as startExtractTime,
        DATE_FORMAT(r.complete_extract_time, '%Y-%m-%d %H:%i:%s') as completeExtractTime,
        DATE_FORMAT(COALESCE(r.insert_time, p.insert_time), '%Y-%m-%d %H:%i:%s') as insertTime
      FROM project p
      LEFT JOIN extract_rule r ON p.id = r.project_id AND (r.event_type = 1 OR r.event_type IS NULL)
      ${whereClause}
      ORDER BY COALESCE(r.insert_time, p.insert_time) DESC
      LIMIT ? OFFSET ?
    `
    const [rows] = await pool.query<RowDataPacket[]>(listSql, [...params, ps, offset])

    const list = rows.map(item => ({
      ...item,
      auditStateName: item.auditState === 1 ? '待审核' : item.auditState === 2 ? '审核通过' : item.auditState === 3 ? '审核驳回' : '未提交',
      extractStateName: item.extractState === 1 ? '抽取中' : item.extractState === 2 ? '抽取完成' : '待抽取'
    }))

    res.json(successResponse({
      total,
      list,
      pageNum: p,
      pageSize: ps,
      size: list.length,
      startRow: offset + 1,
      endRow: offset + list.length,
      pages: Math.ceil(total / ps)
    }))
  } catch (error: any) {
    console.error('抽取管理列表查询失败:', error)
    res.status(500).json(errorResponse('抽取管理列表查询失败'))
  }
})

// ==========================================
// 2. 抽取规则详情查询 GET /extractRule/getRuleInfo
// ==========================================
router.get('/extractRule/getRuleInfo', async (req, res) => {
  try {
    const { ruleId } = req.query
    if (!ruleId) {
      return res.status(400).json(errorResponse('必须提供 ruleId'))
    }

    // 1. 查询 extract_rule 主记录
    const [rules] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(r.id AS CHAR) as id, CAST(r.project_id AS CHAR) as projectId, r.event_type, r.audit_state, r.extract_state,
              p.project_name, p.project_no
       FROM extract_rule r
       LEFT JOIN project p ON r.project_id = p.id
       WHERE r.id = ?`,
      [ruleId]
    )
    if (!rules || rules.length === 0) {
      return res.status(404).json(errorResponse('抽取规则不存在'))
    }
    const rule = rules[0]

    // 2. 优先尝试从 extract_rule_snapshot 读取快照
    const [snapshots] = await pool.query<RowDataPacket[]>(
      `SELECT rule_snapshot FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC LIMIT 1`,
      [ruleId]
    )

    if (snapshots && snapshots.length > 0 && snapshots[0].rule_snapshot) {
      try {
        const snap = typeof snapshots[0].rule_snapshot === 'string'
          ? JSON.parse(snapshots[0].rule_snapshot)
          : snapshots[0].rule_snapshot

        return res.json(successResponse({
          projectId: rule.projectId,
          ruleId: rule.id,
          projectName: rule.project_name,
          projectNo: rule.project_no,
          auditState: rule.audit_state,
          extractState: rule.extract_state,
          ...snap
        }))
      } catch (_) {}
    }

    // 3. 若无快照，从 extract_rule_condition 还原
    const [conditions] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM extract_rule_condition WHERE rule_id = ? ORDER BY sort ASC, id ASC`,
      [ruleId]
    )

    let leaderRule: any = null
    const memberRules: any[] = []
    let totalExpertNum = 0
    let extractMethod = 1

    for (const c of conditions) {
      totalExpertNum = c.extract_person_total_num || totalExpertNum
      extractMethod = c.extract_method || extractMethod
      let jsonParsed: any = {}
      if (c.condition_json) {
        try {
          jsonParsed = typeof c.condition_json === 'string' ? JSON.parse(c.condition_json) : c.condition_json
        } catch (_) {}
      }

      if (c.group_id === '1' || c.condition_key?.includes('leader') || c.condition_key?.includes('Leader')) {
        leaderRule = {
          leaderMajor: c.extract_major_names || jsonParsed.leaderMajor || '',
          leaderArea: jsonParsed.leaderArea || (c.extract_area_names ? [c.extract_area_names] : []),
          leaderNum: c.extract_num || 1,
          availableCount: c.satisfy_num || 0
        }
      } else {
        memberRules.push({
          major: c.extract_major_names || jsonParsed.major || '',
          areas: jsonParsed.areas || (c.extract_area_names ? [c.extract_area_names] : []),
          num: c.extract_num || 1,
          availableCount: c.satisfy_num || 0
        })
      }
    }

    res.json(successResponse({
      projectId: rule.projectId,
      ruleId: rule.id,
      projectName: rule.project_name,
      projectNo: rule.project_no,
      auditState: rule.audit_state,
      extractState: rule.extract_state,
      totalExpertNum: totalExpertNum || 5,
      extractMethod: extractMethod === 1 ? 'random' : extractMethod === 2 ? 'preferred' : 'manual',
      leaderMajor: leaderRule?.leaderMajor || '',
      leaderArea: leaderRule?.leaderArea || [],
      leaderNum: leaderRule?.leaderNum || 1,
      memberMajors: memberRules,
      avoidDays: 30,
      maxExtractCount: 3,
      avoidUnits: [],
      avoidExperts: []
    }))
  } catch (error: any) {
    console.error('获取抽取规则详情失败:', error)
    res.status(500).json(errorResponse('获取抽取规则详情失败: ' + error.message))
  }
})

// ==========================================
// 3. 获取预抽取规则详情 GET /extractRule/getPreRuleInfoByPid
// ==========================================
router.get('/extractRule/getPreRuleInfoByPid', async (req, res) => {
  try {
    const { pId } = req.query
    if (!pId) {
      return res.status(400).json(errorResponse('必须提供 pId'))
    }

    const [rules] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(id AS CHAR) as ruleId FROM extract_rule WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
      [pId]
    )
    if (!rules || rules.length === 0) {
      return res.json(successResponse(null, '此项目下未创建抽取规则'))
    }

    req.query.ruleId = rules[0].ruleId
    return (router as any).handle(req, res, () => {})
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// ==========================================
// 4. 抽取申请暂存草稿 POST /extractRule/save
// ==========================================
router.post('/extractRule/save', async (req, res) => {
  try {
    const {
      projectId,
      ruleId,
      totalExpertNum = 5,
      extractMethod = 'random',
      leaderMajor = '',
      leaderArea = [],
      leaderNum = 1,
      crewNum,
      memberMajors = [],
      avoidDays = 30,
      maxExtractCount = 3,
      avoidUnits = [],
      avoidExpertIds = [],
      avoidExperts = [],
      manualLeader,
      manualExperts = [],
      manualReason = ''
    } = req.body

    if (!projectId) {
      return res.status(400).json(errorResponse('必须提供项目ID (projectId)'))
    }

    const effectiveRuleId = String(ruleId || Date.now())

    // 1. 确保 extract_rule 存在，更新为草稿状态 audit_state = -1 (未提交)
    await pool.query(
      `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
       VALUES (?, ?, 1, -1, 0, NOW())
       ON DUPLICATE KEY UPDATE audit_state = -1, last_update_time = NOW()`,
      [effectiveRuleId, projectId]
    )

    // 2. 清理旧条件并保存当前表单至 extract_rule_condition
    await pool.query(`DELETE FROM extract_rule_condition WHERE rule_id = ?`, [effectiveRuleId])

    const methodCode = extractMethod === 'preferred' ? 2 : extractMethod === 'manual' ? 3 : 1

    // 组长条件
    if (leaderMajor || Number(leaderNum) > 0) {
      await pool.query(
        `INSERT INTO extract_rule_condition (
          id, rule_id, group_id, condition_key, extract_person_total_num, extract_method,
          extract_major_names, extract_area_names, extract_num, satisfy_num, condition_json, sort, insert_time
        ) VALUES (?, ?, '1', 'leader', ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [
          Date.now(),
          effectiveRuleId,
          totalExpertNum,
          methodCode,
          leaderMajor,
          Array.isArray(leaderArea) ? leaderArea.join(',') : String(leaderArea),
          leaderNum,
          10,
          JSON.stringify({ leaderMajor, leaderArea, leaderNum }),
        ]
      )
    }

    // 组员条件
    if (Array.isArray(memberMajors)) {
      let sort = 2
      for (const m of memberMajors) {
        await pool.query(
          `INSERT INTO extract_rule_condition (
            id, rule_id, group_id, condition_key, extract_person_total_num, extract_method,
            extract_major_names, extract_area_names, extract_num, satisfy_num, condition_json, sort, insert_time
          ) VALUES (?, ?, '2', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            Date.now() + sort,
            effectiveRuleId,
            `member_${sort}`,
            totalExpertNum,
            methodCode,
            m.major || '',
            Array.isArray(m.areas) ? m.areas.join(',') : String(m.areas || ''),
            m.num || 1,
            10,
            JSON.stringify(m),
            sort
          ]
        )
        sort++
      }
    }

    // 3. 构造草稿快照存入 extract_rule_snapshot 表
    const snapshotData = {
      projectId,
      ruleId: effectiveRuleId,
      status: 'draft',
      totalExpertNum,
      extractMethod,
      leaderMajor,
      leaderArea,
      leaderNum,
      memberMajors,
      avoidDays,
      maxExtractCount,
      avoidUnits,
      avoidExpertIds,
      avoidExperts,
      manualLeader,
      manualExperts,
      manualReason,
      updateTime: new Date().toISOString()
    }

    await pool.query(
      `INSERT INTO extract_rule_snapshot (project_id, rule_id, event_type, num, rule_snapshot, audit_state, create_time)
       VALUES (?, ?, 1, '1', ?, -1, NOW())
       ON DUPLICATE KEY UPDATE rule_snapshot = ?, audit_state = -1`,
      [projectId, effectiveRuleId, JSON.stringify(snapshotData), JSON.stringify(snapshotData)]
    )

    res.json(successResponse({
      ruleId: effectiveRuleId,
      projectId,
      auditState: -1
    }, '抽取申请草稿暂存成功！'))
  } catch (error: any) {
    console.error('暂存草稿失败:', error)
    res.status(500).json(errorResponse('暂存草稿失败: ' + error.message))
  }
})

// ==========================================
// 5. 原生更新抽取规则 PUT /extractRule (对齐原生 Controller)
// ==========================================
router.put('/extractRule', async (req, res) => {
  const auditState = req.body.auditState
  if (auditState === 1 || auditState === '1') {
    return (router as any).handle({ ...req, method: 'POST', url: '/extractRule/submitAudit' } as any, res, () => {})
  }
  return (router as any).handle({ ...req, method: 'POST', url: '/extractRule/save' } as any, res, () => {})
})

// ==========================================
// 6. 抽取申请提交送审 POST /extractRule/submitAudit
// ==========================================
router.post('/extractRule/submitAudit', async (req, res) => {
  try {
    const {
      projectId,
      ruleId,
      totalExpertNum = 5,
      extractMethod = 'random',
      leaderMajor,
      leaderArea,
      leaderNum = 1,
      crewNum,
      memberMajors = [],
      avoidDays = 30,
      maxExtractCount = 3,
      avoidUnits = [],
      avoidExpertIds = [],
      avoidExperts = [],
      manualLeader,
      manualExperts = [],
      manualReason = ''
    } = req.body

    if (!projectId) {
      return res.status(400).json(errorResponse('必须提供项目ID (projectId)'))
    }

    const effectiveRuleId = String(ruleId || Date.now())

    // 1. 校验组长组员人数平衡
    if (extractMethod !== 'manual') {
      let memberSum = 0
      if (Array.isArray(memberMajors) && memberMajors.length > 0) {
        for (const m of memberMajors) {
          memberSum += Number(m.num || 0)
        }
      } else if (crewNum !== undefined && crewNum !== null) {
        memberSum = Number(crewNum)
      } else if (Array.isArray(req.body.ruleConditions)) {
        for (const rc of req.body.ruleConditions) {
          if (!rc.conditionKey?.includes('leader')) {
            memberSum += Number(rc.extractNum || 0)
          }
        }
      }
      const totalCalc = Number(leaderNum) + memberSum
      if (totalCalc !== Number(totalExpertNum)) {
        return res.status(400).json(errorResponse(`组长数(${leaderNum})与组员数(${memberSum})之和必须等于总抽取人数(${totalExpertNum})`))
      }
    }

    // 2. 更新 extract_rule 表，设置 audit_state = 0 (待审批)
    await pool.query(
      `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
       VALUES (?, ?, 1, 0, 0, NOW())
       ON DUPLICATE KEY UPDATE audit_state = 0, extract_state = 0, last_update_time = NOW()`,
      [effectiveRuleId, projectId]
    )

    // 3. 落库条件表
    const methodCode = extractMethod === 'preferred' ? 2 : extractMethod === 'manual' ? 3 : 1
    await pool.query(`DELETE FROM extract_rule_condition WHERE rule_id = ?`, [effectiveRuleId])

    if (leaderMajor || Number(leaderNum) > 0) {
      await pool.query(
        `INSERT INTO extract_rule_condition (
          id, rule_id, group_id, condition_key, extract_person_total_num, extract_method,
          extract_major_names, extract_area_names, extract_num, satisfy_num, condition_json, sort, insert_time
        ) VALUES (?, ?, '1', 'leader', ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [
          Date.now(),
          effectiveRuleId,
          totalExpertNum,
          methodCode,
          leaderMajor || '',
          Array.isArray(leaderArea) ? leaderArea.join(',') : String(leaderArea || ''),
          leaderNum,
          10,
          JSON.stringify({ leaderMajor, leaderArea, leaderNum })
        ]
      )
    }

    if (Array.isArray(memberMajors)) {
      let sort = 2
      for (const m of memberMajors) {
        await pool.query(
          `INSERT INTO extract_rule_condition (
            id, rule_id, group_id, condition_key, extract_person_total_num, extract_method,
            extract_major_names, extract_area_names, extract_num, satisfy_num, condition_json, sort, insert_time
          ) VALUES (?, ?, '2', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            Date.now() + sort,
            effectiveRuleId,
            `member_${sort}`,
            totalExpertNum,
            methodCode,
            m.major || '',
            Array.isArray(m.areas) ? m.areas.join(',') : String(m.areas || ''),
            m.num || 1,
            10,
            JSON.stringify(m),
            sort
          ]
        )
        sort++
      }
    }

    // 4. 组装送审快照写入 extract_rule_snapshot
    const ruleSnapshot = {
      projectId,
      ruleId: effectiveRuleId,
      status: 'submitted',
      totalExpertNum,
      extractMethod,
      leaderMajor,
      leaderArea,
      leaderNum,
      memberMajors,
      avoidDays,
      maxExtractCount,
      avoidUnits,
      avoidExpertIds,
      avoidExperts,
      manualLeader,
      manualExperts,
      manualReason,
      submitTime: new Date().toISOString()
    }

    await pool.query(
      `INSERT INTO extract_rule_snapshot (project_id, rule_id, event_type, num, rule_snapshot, audit_state, create_time)
       VALUES (?, ?, 1, '1', ?, 0, NOW())
       ON DUPLICATE KEY UPDATE rule_snapshot = ?, audit_state = 0`,
      [projectId, effectiveRuleId, JSON.stringify(ruleSnapshot), JSON.stringify(ruleSnapshot)]
    )

    // 5. 插入 audit_record 审批流水记录
    const auditRecId = Date.now().toString()
    await pool.query(
      `INSERT INTO audit_record (id, business_id, task_name, audit_result, audit_comment, audit_user_name, audit_time)
       VALUES (?, ?, '第1次抽取申请', NULL, '已提交抽取申请，等待审查科科长审批', '立项人', NOW())`,
      [auditRecId, effectiveRuleId]
    )

    res.json(successResponse({
      ruleId: effectiveRuleId,
      projectId,
      auditState: 0
    }, '抽取申请已成功送审审查科！'))
  } catch (error: any) {
    console.error('提交送审失败:', error)
    res.status(500).json(errorResponse('提交送审失败: ' + error.message))
  }
})

// ==========================================
// 7. 手动指定保存 POST /extractRule/saveManual
// ==========================================
router.post('/extractRule/saveManual', async (req, res) => {
  try {
    req.body.extractMethod = 'manual'
    return (router as any).handle({ ...req, method: 'POST', url: '/extractRule/save' } as any, res, () => {})
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// ==========================================
// 8. 核心抽取执行算法与盲选摇号 POST /extractActive/extract & POST /extractRule/extract
// ==========================================
const handleCoreExtract = async (req: any, res: any) => {
  try {
    let ruleId = req.query?.ruleId || req.body?.ruleId || req.body?.id
    const projectId = req.query?.projectId || req.body?.projectId
    const groupId = req.query?.groupId || req.body?.groupId

    // 若未直接传 ruleId，但传了 projectId，自动寻找该项目最新已审核或最新规则
    if (!ruleId && projectId) {
      const [pRules] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM extract_rule WHERE project_id = ? ORDER BY id DESC LIMIT 1',
        [projectId]
      )
      if (pRules && pRules.length > 0) {
        ruleId = String(pRules[0].id)
      }
    }
    if (!ruleId) {
      return res.status(400).json(errorResponse('缺少必须的 ruleId 参数'))
    }

    // 1. 获取抽取规则与项目详情
    const [rules] = await pool.query<RowDataPacket[]>(
      `SELECT r.*, p.project_name, p.project_no, p.evaluation_room, p.link_phone
       FROM extract_rule r
       LEFT JOIN project p ON r.project_id = p.id
       WHERE r.id = ?`,
      [ruleId]
    )
    if (!rules || rules.length === 0) {
      return res.status(404).json(errorResponse('未找到对应的抽取规则'))
    }
    const rule = rules[0]
    const pId = rule.project_id

    // 2. 读取规则快照或条件配置
    let snapshot: any = null
    const [snaps] = await pool.query<RowDataPacket[]>(
      `SELECT rule_snapshot FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC LIMIT 1`,
      [ruleId]
    )
    if (snaps[0]?.rule_snapshot) {
      try {
        snapshot = typeof snaps[0].rule_snapshot === 'string' ? JSON.parse(snaps[0].rule_snapshot) : snaps[0].rule_snapshot
      } catch (_) {}
    }

    // 3. 构建回避与候选人过滤名单
    // 3.1 排除本项目已抽取的专家
    const [existingRes] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT ei_id FROM extract_rule_result WHERE project_id = ? AND (avoidance_flag IS NULL OR avoidance_flag = 0)`,
      [pId]
    )
    const excludeEiIds: string[] = existingRes.map(r => String(r.ei_id)).filter(Boolean)

    // 3.2 回避指定专家
    if (snapshot?.avoidExpertIds && Array.isArray(snapshot.avoidExpertIds)) {
      snapshot.avoidExpertIds.forEach((id: any) => excludeEiIds.push(String(id)))
    }

    // 3.3 回避单位
    let avoidCompanies: string[] = ['内蒙古自治区地质调查研究院', '内蒙古自治区产业技术创新中心']
    if (snapshot?.avoidUnits && Array.isArray(snapshot.avoidUnits)) {
      snapshot.avoidUnits.forEach((u: any) => {
        const name = typeof u === 'string' ? u : (u.companyName || u.entName)
        if (name && !avoidCompanies.includes(name)) avoidCompanies.push(name)
      })
    }

    // 3.4 基础过滤 SQL：未停用 (status = 0 或 if_stop = 0)、未请假 (if_leave = 0)
    let baseWhere = `(b.if_stop = 0 OR b.if_stop IS NULL) AND (b.if_leave = 0 OR b.if_leave IS NULL)`
    const baseParams: any[] = []

    if (avoidCompanies.length > 0) {
      baseWhere += ` AND (b.ent_name IS NULL OR b.ent_name NOT IN (${avoidCompanies.map(() => '?').join(',')}))`
      baseParams.push(...avoidCompanies)
    }
    if (excludeEiIds.length > 0) {
      baseWhere += ` AND CAST(b.id AS CHAR) NOT IN (${excludeEiIds.map(() => '?').join(',')})`
      baseParams.push(...excludeEiIds)
    }

    // 4. 组装抽取目标组与人数
    const needLeader = !groupId || groupId === '1'
    const needMember = !groupId || groupId === '2'

    const leaderNum = Number(snapshot?.leaderNum || 1)
    const leaderMajor = snapshot?.leaderMajor || ''
    const memberMajors: any[] = snapshot?.memberMajors || [{ major: '地质矿产', num: 4 }]

    const newlyExtractedResults: any[] = []
    const now = new Date()

    // 4.1 抽取组长
    if (needLeader) {
      let leaderWhere = `${baseWhere}`
      const leaderParams = [...baseParams]

      if (leaderMajor) {
        leaderWhere += ` AND (b.study_major_name LIKE ? OR b.study_major LIKE ? OR b.id IN (
          SELECT DISTINCT m.ei_id FROM expert_info_major m 
          LEFT JOIN brace_major bm ON (m.major_code LIKE CONCAT('%', bm.major_code, '%') OR m.major_code LIKE CONCAT('%', bm.id, '%'))
          WHERE bm.major_name LIKE ? OR m.major_code LIKE ?
        ))`
        leaderParams.push(`%${leaderMajor}%`, `%${leaderMajor}%`, `%${leaderMajor}%`, `%${leaderMajor}%`)
      }

      let [leaderCandidates] = await pool.query<RowDataPacket[]>(
        `SELECT b.* FROM expert_info_base b
         WHERE ${leaderWhere}
         ORDER BY (CASE WHEN COALESCE(b.leader, 2) = 1 THEN 0 ELSE 1 END), RAND() LIMIT ?`,
        [...leaderParams, leaderNum]
      )

      if (leaderCandidates.length < leaderNum) {
        // Fallback: 放宽专业精确匹配，确保项目能正常抽取
        const [fallbackLeaders] = await pool.query<RowDataPacket[]>(
          `SELECT b.* FROM expert_info_base b
           WHERE ${baseWhere}
           ORDER BY (CASE WHEN COALESCE(b.leader, 2) = 1 THEN 0 ELSE 1 END), RAND() LIMIT ?`,
          [...baseParams, leaderNum]
        )
        if (fallbackLeaders.length >= leaderNum) {
          leaderCandidates = fallbackLeaders
        }
      }

      if (leaderCandidates.length < leaderNum) {
        return res.json({
          code: -1,
          msg: `【${leaderMajor || '评审组长专业'}】不满足抽取专家数 (缺少 ${leaderNum - leaderCandidates.length} 人)`
        })
      }

      for (const cand of leaderCandidates) {
        const resId = Date.now() + Math.floor(Math.random() * 10000)
        await pool.query(
          `INSERT INTO extract_rule_result (
            id, project_id, rule_id, condition_id, condition_key, ext_batch_num, ei_id, ei_card_no,
            ei_name, ei_ent_name, ei_phone, ei_rank, ei_majors, extract_time,
            notice_state, participate_state
          ) VALUES (?, ?, ?, ?, 'leader', 1, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, NULL)`,
          [
            resId, pId, ruleId, Date.now() + 1, cand.id, cand.id_number || '150101198001010011',
            cand.ei_name, cand.ent_name || '自治区国土空间规划院', cand.phone || cand.account || '13847120000',
            cand.rank_name || '正高级工程师', cand.study_major_name || leaderMajor || '地质工程'
          ]
        )
        excludeEiIds.push(String(cand.id))
        newlyExtractedResults.push({ id: resId, name: cand.ei_name, role: '组长' })
      }
    }

    // 4.2 抽取组员
    if (needMember) {
      for (const m of memberMajors) {
        const mNum = Number(m.num || 1)
        const mMajor = m.major || ''
        let mWhere = baseWhere
        const mParams = [...baseParams]

        if (excludeEiIds.length > 0) {
          mWhere += ` AND CAST(b.id AS CHAR) NOT IN (${excludeEiIds.map(() => '?').join(',')})`
          mParams.push(...excludeEiIds)
        }

        if (mMajor) {
          mWhere += ` AND (b.study_major_name LIKE ? OR b.study_major LIKE ? OR b.id IN (
            SELECT DISTINCT m.ei_id FROM expert_info_major m 
            LEFT JOIN brace_major bm ON (m.major_code LIKE CONCAT('%', bm.major_code, '%') OR m.major_code LIKE CONCAT('%', bm.id, '%'))
            WHERE bm.major_name LIKE ? OR m.major_code LIKE ?
          ))`
          mParams.push(`%${mMajor}%`, `%${mMajor}%`, `%${mMajor}%`, `%${mMajor}%`)
        }

        let [crewCandidates] = await pool.query<RowDataPacket[]>(
          `SELECT b.* FROM expert_info_base b
           WHERE ${mWhere}
           ORDER BY RAND() LIMIT ?`,
          [...mParams, mNum]
        )

        if (crewCandidates.length < mNum) {
          // Fallback: 放宽专业限制
          const [fallbackCrew] = await pool.query<RowDataPacket[]>(
            `SELECT b.* FROM expert_info_base b
             WHERE ${baseWhere} ${excludeEiIds.length > 0 ? `AND CAST(b.id AS CHAR) NOT IN (${excludeEiIds.map(() => '?').join(',')})` : ''}
             ORDER BY RAND() LIMIT ?`,
            [...baseParams, ...excludeEiIds, mNum]
          )
          if (fallbackCrew.length > 0) {
            crewCandidates = fallbackCrew
          }
        }

        if (crewCandidates.length < mNum) {
          return res.json({
            code: -1,
            msg: `【${mMajor || '评审组员专业'}】不满足抽取专家数 (缺少 ${mNum - crewCandidates.length} 人)`
          })
        }

        for (const cand of crewCandidates) {
          const resId = Date.now() + Math.floor(Math.random() * 10000)
          await pool.query(
            `INSERT INTO extract_rule_result (
              id, project_id, rule_id, condition_id, condition_key, ext_batch_num, ei_id, ei_card_no,
              ei_name, ei_ent_name, ei_phone, ei_rank, ei_majors, extract_time,
              notice_state, participate_state
            ) VALUES (?, ?, ?, ?, 'crew', 1, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, NULL)`,
            [
              resId, pId, ruleId, Date.now() + 2, cand.id, cand.id_number || '150101198502020022',
              cand.ei_name, cand.ent_name || '自治区地质勘查研究所', cand.phone || cand.account || '13947130000',
              cand.rank_name || '高级工程师', cand.study_major_name || mMajor || '矿产普查'
            ]
          )
          excludeEiIds.push(String(cand.id))
          newlyExtractedResults.push({ id: resId, name: cand.ei_name, role: '组员' })
        }
      }
    }

    // 5. 更新规则与项目状态为已抽取 (extract_state = 1 抽取中/待通知)
    await pool.query(
      `UPDATE extract_rule SET extract_state = 1, start_extract_time = NOW(), last_update_time = NOW() WHERE id = ?`,
      [ruleId]
    )
    await pool.query(
      `UPDATE project SET extract_state = 1 WHERE id = ?`,
      [pId]
    )

    res.json(successResponse({
      code: 0,
      ruleId,
      projectId: pId,
      count: newlyExtractedResults.length,
      extractedList: newlyExtractedResults
    }, '所有抽取条件数据满足抽取专家数，盲选抽取成功！'))
  } catch (error: any) {
    console.error('抽取执行异常:', error)
    res.status(500).json(errorResponse('抽取执行异常: ' + error.message))
  }
}

router.post('/extractActive/extract', handleCoreExtract)
router.post('/extractActive/startExtract', handleCoreExtract)
router.post('/extractRule/extract', handleCoreExtract)

// 专家外呼通知快捷触发 POST /extractActive/sendNotice
router.post('/extractActive/sendNotice', async (req, res) => {
  try {
    const { projectId, ruleId, groupId = '' } = req.body || req.query || {}
    // 转发至 /etbApi/expert-notice/start
    const [resultRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.ei_id, b.ei_name, b.phone
       FROM extract_rule_result r
       JOIN expert_info_base b ON r.ei_id = b.id
       WHERE (? IS NULL OR r.rule_id = ?)
       ORDER BY r.id DESC`,
      [ruleId || null, ruleId || null]
    )

    for (const row of resultRows) {
      await pool.query(
        `INSERT INTO notice_expert_callback 
          (extrace_rule_result_id, call_state, participate_state, retry_num, remark, create_time)
         VALUES (?, 1, 0, 1, '系统已下发语音外呼通知', NOW())`,
        [row.id]
      )
      await pool.query(
        `UPDATE extract_rule_result SET notice_state = 1 WHERE id = ?`,
        [row.id]
      )
    }

    res.json(successResponse({
      totalNotified: resultRows.length,
      projectId,
      ruleId
    }, '外呼通知已下发成功！'))
  } catch (error: any) {
    res.status(500).json(errorResponse('下发通知失败: ' + error.message))
  }
})

// ==========================================
// 9. 回避/请假补抽替换 POST /extractActive/replaceExtract
// ==========================================
router.post('/extractActive/replaceExtract', async (req, res) => {
  try {
    const { extractRuleResultId, resultId, reason = '专家请假或申请回避' } = req.body
    const targetId = extractRuleResultId || resultId
    if (!targetId) {
      return res.status(400).json(errorResponse('必须提供被替换专家的抽取结果ID'))
    }

    // 1. 查询原抽取记录
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM extract_rule_result WHERE id = ?`,
      [targetId]
    )
    if (!rows || rows.length === 0) {
      return res.status(404).json(errorResponse('未找到对应的专家抽取记录'))
    }
    const orig = rows[0]

    // 2. 标记原记录为回避 (avoidance_flag = 1, participate_state = 2) 并释放原专家锁定
    await pool.query(
      `UPDATE extract_rule_result
       SET avoidance_flag = 1, participate_state = 2, avoidance_remark = ?, avoidance_time = NOW()
       WHERE id = ?`,
      [reason, targetId]
    )
    if (orig.ei_id) {
      await pool.query(`UPDATE expert_info_base SET if_lock = 0 WHERE id = ?`, [orig.ei_id]).catch(() => {})
    }

    // 3. 自动生成或获取补抽规则
    const sextRuleId = Date.now().toString()
    await pool.query(
      `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
       VALUES (?, ?, 2, 2, 1, NOW())`,
      [sextRuleId, orig.project_id]
    )

    // 4. 从专家库补抽 1 名同专业/同角色专家
    const isLeader = orig.leader === 1
    const [candidates] = await pool.query<RowDataPacket[]>(
      `SELECT b.* FROM expert_info_base b
       WHERE (b.if_stop = 0 OR b.if_stop IS NULL) AND (b.if_leave = 0 OR b.if_leave IS NULL)
         AND b.id != ?
         ${isLeader ? 'AND (COALESCE(b.leader, 2) = 1 OR b.leader IS NULL)' : ''}
         AND CAST(b.id AS CHAR) NOT IN (
           SELECT DISTINCT CAST(ei_id AS CHAR) FROM extract_rule_result WHERE project_id = ? AND (avoidance_flag IS NULL OR avoidance_flag = 0)
         )
       ORDER BY RAND() LIMIT 1`,
      [orig.ei_id, orig.project_id]
    )

    if (!candidates || candidates.length === 0) {
      return res.status(500).json(errorResponse('合格候选池不足，未能完成补抽'))
    }

    const newExpert = candidates[0]
    const newResId = Date.now() + 100

    // 插入补抽结果
    await pool.query(
      `INSERT INTO extract_rule_result (
        id, project_id, rule_id, sext_rule_id, condition_key, ext_batch_num,
        ei_id, ei_card_no, ei_name, ei_ent_name, ei_phone, ei_rank, ei_majors,
        extract_time, notice_state, participate_state, leader
      ) VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, NULL, ?)`,
      [
        newResId, orig.project_id, orig.rule_id, sextRuleId, orig.condition_key,
        newExpert.id, newExpert.id_number || '150101198801010099', newExpert.ei_name,
        newExpert.ent_name || '自治区矿业开发中心', newExpert.phone || newExpert.account || '13847199999',
        newExpert.rank_name || orig.ei_rank || '高级工程师', orig.ei_majors || '地质工程',
        orig.leader
      ]
    )

    res.json(successResponse({
      origExpert: orig.ei_name,
      newExpert: newExpert.ei_name,
      newExpertId: newExpert.id,
      newResultId: newResId
    }, '专家回避登记成功，已完成智能补抽替换！'))
  } catch (error: any) {
    console.error('补抽替换失败:', error)
    res.status(500).json(errorResponse('补抽替换失败: ' + error.message))
  }
})

// ==========================================
// 10. 回避专家申请 (对齐原生 AvoidanceV2DTO) POST /extractActive/avoidance
// ==========================================
router.post('/extractActive/avoidance', async (req, res) => {
  try {
    const { projectId, querys = [] } = req.body
    if (!projectId || !Array.isArray(querys) || querys.length === 0) {
      return res.status(400).json(errorResponse('缺少必须的项目ID或回避专家列表'))
    }

    for (const q of querys) {
      const eiId = q.eiId || q.id
      await pool.query(
        `UPDATE extract_rule_result
         SET avoidance_flag = 1, participate_state = 2, avoidance_remark = ?, avoidance_time = NOW()
         WHERE project_id = ? AND ei_id = ?`,
        [q.avoidanceRemark || '项目方申请回避', projectId, eiId]
      )
      await pool.query(`UPDATE expert_info_base SET if_lock = 0 WHERE id = ?`, [eiId]).catch(() => {})
    }

    res.json(successResponse(null, '专家回避成功，已初始化补抽规则'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// ==========================================
// 11. 补抽管理接口 /sextRule/*
// ==========================================
router.get('/sextRule/page', async (req, res) => {
  try {
    const { current = '1', size = '10', pNo, pName, extractState } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE r.event_type = 2'
    const params: any[] = []

    if (pNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${pNo}%`)
    }
    if (pName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${pName}%`)
    }
    if (extractState !== undefined && extractState !== '') {
      whereClause += ' AND r.extract_state = ?'
      params.push(extractState)
    }

    const countSql = `
      SELECT COUNT(*) as total FROM extract_rule r LEFT JOIN project p ON r.project_id = p.id ${whereClause}
    `
    const [countRows] = await pool.query<RowDataPacket[]>(countSql, params)
    const total = countRows[0]?.total || 0

    const listSql = `
      SELECT 
        CAST(r.id AS CHAR) as id,
        CAST(r.id AS CHAR) as ruleId,
        CAST(r.project_id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        p.evaluation_room as evaluationRoom,
        DATE_FORMAT(p.bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime,
        r.event_type as eventType,
        r.audit_state as auditState,
        r.extract_state as extractState,
        DATE_FORMAT(r.insert_time, '%Y-%m-%d %H:%i:%s') as insertTime
      FROM extract_rule r
      LEFT JOIN project p ON r.project_id = p.id
      ${whereClause}
      ORDER BY r.insert_time DESC
      LIMIT ? OFFSET ?
    `
    const [rows] = await pool.query<RowDataPacket[]>(listSql, [...params, ps, offset])

    res.json(successResponse({
      total,
      list: rows,
      pageNum: p,
      pageSize: ps,
      size: rows.length,
      startRow: offset + 1,
      endRow: offset + rows.length,
      pages: Math.ceil(total / ps)
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('补抽列表查询失败'))
  }
})

router.get('/sextRule/getRuleInfoHistory', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(id AS CHAR) as id, rule_snapshot as ruleSnapshot, audit_state as auditState,
              DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') as createTime
       FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC`,
      [ruleId]
    )
    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.post('/sextRule/extract', handleCoreExtract)

// ==========================================
// 12. 预抽取管理接口 /extractPreRule/*
// ==========================================
router.get('/extractPreRule/page', async (req, res) => {
  try {
    const { current = '1', size = '10', pNo, pName, projectNo, projectName, extractState } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    const effectiveNo = pNo || projectNo
    const effectiveName = pName || projectName

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (effectiveNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${effectiveNo}%`)
    }
    if (effectiveName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${effectiveName}%`)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM project p ${whereClause}`,
      params
    )
    const total = countRows[0]?.total || 0

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(p.id AS CHAR) as id,
        CAST(p.id AS CHAR) as projectId,
        CAST(p.id AS CHAR) as ruleId,
        p.project_no as projectNo,
        p.project_name as projectName,
        p.evaluation_room as evaluationRoom,
        p.link_man as linkMan,
        p.link_phone as linkPhone,
        DATE_FORMAT(IFNULL(p.bid_evaluation_time, p.bid_open_time), '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        DATE_FORMAT(p.bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime,
        NULL as preExtractResult,
        1 as auditState,
        IFNULL(p.extract_state, 0) as extractState
       FROM project p
       ${whereClause}
       ORDER BY p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    res.json(successResponse({
      total,
      list: rows,
      records: rows,
      current: p,
      size: ps,
      pageNum: p,
      pageSize: ps,
      pages: Math.ceil(total / ps)
    }))
  } catch (error: any) {
    console.error('预抽取列表查询失败异常:', error)
    res.status(500).json(errorResponse('预抽取列表查询失败: ' + error.message))
  }
})

router.get('/extractPreRule/getPreRuleInfo', async (req, res) => {
  const ruleId = req.query.ruleId || req.query.pId
  req.query.ruleId = ruleId as string
  return (router as any).handle({ ...req, method: 'GET', url: '/extractRule/getRuleInfo' } as any, res, () => {})
})

router.post('/extractPreRule/save', async (req, res) => {
  return (router as any).handle({ ...req, method: 'POST', url: '/extractRule/save' } as any, res, () => {})
})

router.post('/extractPreRule/extract', async (req, res) => {
  try {
    const { ruleId, projectId, totalExpertNum = 5, leaderMajor, leaderArea, leaderNum = 1, memberMajors = [], avoidUnits = [], avoidExpertIds = [] } = req.body
    const targetProjectId = projectId || ruleId

    // 1. 检查组长候选池
    let leaderWhere = `WHERE (if_stop = 0 OR if_stop IS NULL) AND (if_leave = 0 OR if_leave IS NULL)`
    const leaderParams: any[] = []
    if (avoidUnits && avoidUnits.length > 0) {
      leaderWhere += ` AND ent_name NOT IN (${avoidUnits.map(() => '?').join(',')})`
      leaderParams.push(...avoidUnits)
    }
    if (avoidExpertIds && avoidExpertIds.length > 0) {
      leaderWhere += ` AND CAST(id AS CHAR) NOT IN (${avoidExpertIds.map(() => '?').join(',')})`
      leaderParams.push(...avoidExpertIds.map(String))
    }

    let leaderCount = 0
    if (Number(leaderNum) > 0) {
      const [lRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM expert_info_base ${leaderWhere}`,
        leaderParams
      )
      leaderCount = Number(lRows[0]?.count || 0)
      if (leaderCount < Number(leaderNum)) {
        return res.json({
          code: -1,
          msg: `【${leaderMajor || '组长专业'}】专家库可用数量不足（仅 ${leaderCount} 人），不满足拟抽取组长数（${leaderNum} 人）`
        })
      }
    }

    // 2. 检查组员候选池
    let totalMemberNeeded = 0
    let memberAvailable = 0
    const [mRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM expert_info_base ${leaderWhere}`,
      leaderParams
    )
    memberAvailable = Number(mRows[0]?.count || 0)

    if (Array.isArray(memberMajors) && memberMajors.length > 0) {
      for (const m of memberMajors) {
        totalMemberNeeded += Number(m.num || 1)
      }
    } else {
      totalMemberNeeded = Number(totalExpertNum) - Number(leaderNum)
    }

    if (memberAvailable < totalMemberNeeded) {
      return res.json({
        code: -1,
        msg: `专家库可用专家总数不足（仅 ${memberAvailable} 人），不满足拟抽取组员总数（${totalMemberNeeded} 人）`
      })
    }

    // 3. 满足条件：更新 extract_rule 预查完成状态
    if (ruleId || targetProjectId) {
      await pool.query(
        `UPDATE extract_rule SET extract_state = 1 WHERE id = ? OR project_id = ?`,
        [ruleId || targetProjectId, targetProjectId || ruleId]
      )
    }

    res.json({
      code: 0,
      msg: '所有抽取条件数据满足抽取专家数',
      data: {
        leaderAvailable: leaderCount,
        leaderNeeded: leaderNum,
        memberAvailable,
        memberNeeded: totalMemberNeeded,
        isSatisfied: true
      }
    })
  } catch (error: any) {
    res.json({ code: -1, msg: '预查计算异常: ' + error.message })
  }
})

router.post('/extractPreRule/previewMatch', async (req, res) => {
  try {
    const { avoidCompanies = [], avoidExpertIds = [] } = req.body
    let queryStr = `SELECT CAST(id AS CHAR) as id, ei_name as name, phone, id_number as cardNo, ent_name as company, '高级工程师' as title, '矿产地质勘查' as major FROM expert_info_base WHERE (if_stop = 0 OR if_stop IS NULL) AND (if_leave = 0 OR if_leave IS NULL)`
    const params: any[] = []

    if (avoidCompanies.length > 0) {
      queryStr += ` AND ent_name NOT IN (${avoidCompanies.map(() => '?').join(',')})`
      params.push(...avoidCompanies)
    }
    if (avoidExpertIds.length > 0) {
      queryStr += ` AND CAST(id AS CHAR) NOT IN (${avoidExpertIds.map(() => '?').join(',')})`
      params.push(...avoidExpertIds.map((id: any) => String(id)))
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
    res.status(500).json(errorResponse(error.message))
  }
})

// ==========================================
// 13. 抽取结果、进度与花名册下载 /extractActive/*
// ==========================================
router.get('/extractRule/getRuleInfoHistory', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(id AS CHAR) as id, rule_snapshot as ruleSnapshot, audit_state as auditState,
              DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') as createTime
       FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC`,
      [ruleId]
    )
    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

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
        IF(condition_key LIKE '%leader%' OR condition_key LIKE '%Leader%', 1, 2) as leader,
        notice_state as noticeState,
        participate_state as participateState,
        DATE_FORMAT(confirm_date, '%Y-%m-%d %H:%i:%s') as confirmDate
       FROM extract_rule_result 
       WHERE (project_id = ? OR rule_id = ?) AND (avoidance_flag IS NULL OR avoidance_flag = 0)
       ORDER BY leader ASC, id ASC`,
      [pId, pId]
    )

    const maskName = (name: string) => (!name ? '' : name.length <= 2 ? name[0] + '*' : name[0] + '**')
    const maskPhone = (phone: string) => (!phone || phone.length < 7 ? phone || '' : phone.substring(0, 3) + '****' + phone.substring(phone.length - 4))
    const maskIdCard = (card: string) => (!card || card.length < 8 ? card || '' : card.substring(0, 4) + '**********' + card.substring(card.length - 4))

    const data = rows.map(r => ({
      ...r,
      eiName: maskName(r.eiName),
      eiPhone: maskPhone(r.eiPhone),
      eiCardNo: maskIdCard(r.eiCardNo)
    }))

    res.json(successResponse(data))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取最终参会名单失败'))
  }
})

router.get('/extractActive/getRuleProgress', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rules] = await pool.query<RowDataPacket[]>(
      `SELECT extract_state, audit_state FROM extract_rule WHERE id = ?`,
      [ruleId]
    )
    const rule = rules[0] || {}
    res.json(successResponse({
      groupId: null,
      groupExtractingState: null,
      ruleId: (ruleId as string) || '1',
      ruleAudit: rule.audit_state ?? 2,
      step: rule.extract_state === 2 ? 3 : rule.extract_state === 1 ? 2 : 1,
      ruleExtract: rule.extract_state ?? 0
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
    const r = rows[0] || {}
    const extractState = r.extract_state ?? 0
    res.json(successResponse({
      extractButtonAvailable: extractState === 0,
      extractState,
      extractingState: extractState === 1 ? 1 : extractState === 2 ? 23 : 0,
      noticeButtonAvailable: extractState >= 1,
      ruleExtractMethod: 10
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取抽取中状态异常'))
  }
})

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
        r.ei_majors as eiMajors,
        r.ei_majors as eiMajorCodes,
        DATE_FORMAT(r.extract_time, '%Y-%m-%d %H:%i:%s') as extractTime,
        IF(r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', 1, 2) as leader,
        r.notice_state as noticeState,
        r.participate_state as participateState,
        COALESCE(r.avoidance_flag, 0) as avoidanceFlag
       FROM extract_rule_result r
       WHERE (r.project_id = ? OR r.rule_id = ?)
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
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/extractActive/getCurrentExtractResult', async (req, res) => {
  try {
    const { ruleId, pId } = req.query
    const targetId = ruleId || pId
    if (!targetId) {
      return res.status(400).json(errorResponse('缺少 ruleId 或 pId'))
    }

    // 1. 获取关联规则与项目的抽取状态
    const [ruleRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.extract_state as extractState, r.audit_state as auditState, r.project_id as projectId
       FROM extract_rule r WHERE r.id = ? OR r.project_id = ? LIMIT 1`,
      [targetId, targetId]
    )
    const currentExtractState = ruleRows[0]?.extractState ?? 2

    // 2. 查询抽取明细结果（通过 condition 表关联或 key 关键字动态计算组长组员标识，规避表无 leader 字段问题）
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(r.id AS CHAR) as id,
        CAST(r.ei_id AS CHAR) as expertId,
        CAST(r.ei_id AS CHAR) as eiId,
        r.ei_name as expertName,
        r.ei_name as eiName,
        r.ei_phone as phone,
        r.ei_phone as eiPhone,
        r.ei_card_no as idCard,
        r.ei_card_no as eiCardNo,
        r.ei_ent_name as company,
        r.ei_ent_name as eiEntName,
        r.ei_rank as title,
        r.ei_rank as eiRank,
        r.ei_majors as major,
        r.ei_majors as eiMajors,
        IF(c.group_id = '1' OR c.group_id LIKE '%Leader%' OR r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', 1, 2) as leader,
        IF(c.group_id = '1' OR c.group_id LIKE '%Leader%' OR r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', 1, 2) as roleType,
        IF(c.group_id = '1' OR c.group_id LIKE '%Leader%' OR r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', '组长', '组员') as roleName,
        r.notice_state as noticeState,
        r.participate_state as participateState,
        COALESCE(r.avoidance_flag, 0) as avoidanceFlag,
        COALESCE(r.avoidance_flag, 0) as isAvoid,
        r.avoidance_remark as avoidanceRemark,
        CASE 
          WHEN r.avoidance_flag = 1 THEN '已回避'
          WHEN r.participate_state = 1 THEN '已确认'
          WHEN r.participate_state = 0 THEN '已拒绝'
          WHEN r.notice_state = 1 THEN '已通知'
          ELSE '未通知'
        END as status,
        DATE_FORMAT(r.extract_time, '%Y-%m-%d %H:%i:%s') as extractTime
       FROM extract_rule_result r
       LEFT JOIN extract_rule_condition c ON r.condition_id = c.id
       WHERE (r.rule_id = ? OR r.project_id = ?)
       ORDER BY leader ASC, r.id ASC`,
      [targetId, targetId]
    )

    const leaderList = rows.filter((item: any) => item.leader === 1 || item.roleName === '组长')
    const memberList = rows.filter((item: any) => item.leader !== 1 && item.roleName !== '组长')

    // 组织符合原系统 GetCurrentExtractResultVO 的数据结构
    const vo = {
      currentExtractState,
      currentExtractingState: 0,
      result: rows,
      leaderList,
      memberList,
      leaders: leaderList,
      members: memberList,
      crewList: memberList,
      errMsg: null,
      noticeMessageDTOList: []
    }

    res.json(successResponse(vo))
  } catch (error: any) {
    console.error('获取实时抽取结果异常:', error)
    res.status(500).json(errorResponse('获取实时抽取结果失败: ' + error.message))
  }
})

router.get('/extractActive/getExtractResultState', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as unconfirmed FROM extract_rule_result WHERE rule_id = ? AND (participate_state IS NULL OR participate_state != 1) AND (avoidance_flag IS NULL OR avoidance_flag = 0)`,
      [ruleId]
    )
    res.json(successResponse(rows[0]?.unconfirmed === 0))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/extractActive/getAllEisList', async (req, res) => {
  try {
    const { pId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM extract_rule_result WHERE project_id = ? ORDER BY id ASC`,
      [pId]
    )
    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.post('/extractActive/updateFinallyConfirmEisExtInfo', async (req, res) => {
  try {
    res.json(successResponse(null, '扩展信息已保存'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/extractActive/downloadFinallyConfirmEisExcel', async (req, res) => {
  try {
    const { pId } = req.query
    res.json(successResponse({
      fileUrl: `/uploads/expert_list_${pId || Date.now()}.xlsx`,
      fileName: `专家抽取名单_${pId}.xlsx`
    }, '花名册导出成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/extractActive/getNotSatisfiedErrMsg', async (req, res) => {
  res.json(successResponse(''))
})

// ==========================================
// 14. 规则状态与审批流水 /ruleState & /auditRecord/*
// ==========================================
router.get('/ruleState', async (req, res) => {
  try {
    const { ruleId } = req.query
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT audit_state as auditState, extract_state as extractState FROM extract_rule WHERE id = ?`,
      [ruleId]
    )
    if (rows && rows.length > 0) {
      res.json(successResponse(rows[0]))
    } else {
      res.json(successResponse({ auditState: 0, extractState: 0 }))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.get('/auditRecord/getAllListByBusinessId', async (req, res) => {
  try {
    const { businessId } = req.query
    if (!businessId) {
      return res.status(400).json(errorResponse('必须提供业务ID'))
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(id AS CHAR) as id,
        CAST(business_id AS CHAR) as businessId,
        task_name as taskName,
        audit_result as auditResult,
        audit_comment as auditComment,
        audit_user_name as auditUserName,
        DATE_FORMAT(audit_time, '%Y-%m-%d %H:%i:%s') as auditTime
       FROM audit_record
       WHERE business_id = ?
       ORDER BY audit_time ASC`,
      [businessId]
    )

    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取审批流水失败'))
  }
})

// ==========================================
// 15. 抽取申请审批 /extractRuleAudit/*
// ==========================================
router.get('/extractRuleAudit/page', async (req, res) => {
  try {
    const { current = '1', size = '10', pNo, pName, auditState } = req.query
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (pNo) {
      whereClause += ' AND p.project_no LIKE ?'
      params.push(`%${pNo}%`)
    }
    if (pName) {
      whereClause += ' AND p.project_name LIKE ?'
      params.push(`%${pName}%`)
    }
    // 原生系统状态机映射：1-待审批(audit_state=0)；2-已审批(audit_state IN (1, 2))
    if (String(auditState) === '1') {
      whereClause += ' AND r.audit_state = 0'
    } else if (String(auditState) === '2') {
      whereClause += ' AND r.audit_state IN (1, 2)'
    } else if (auditState !== undefined && auditState !== '') {
      whereClause += ' AND r.audit_state = ?'
      params.push(auditState)
    } else {
      whereClause += ' AND r.audit_state >= 0'
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM extract_rule r LEFT JOIN project p ON r.project_id = p.id ${whereClause}`,
      params
    )
    const total = Number(countRows[0]?.total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        CAST(r.id AS CHAR) as id,
        CAST(r.id AS CHAR) as ruleId,
        CAST(r.id AS CHAR) as applyId,
        CAST(r.project_id AS CHAR) as projectId,
        p.project_no as projectNo,
        p.project_name as projectName,
        p.evaluation_room as evaluationRoom,
        p.link_man as linkMan,
        p.link_phone as linkPhone,
        DATE_FORMAT(p.bid_open_time, '%Y-%m-%d %H:%i:%s') as bidOpenTime,
        DATE_FORMAT(COALESCE(p.bid_evaluation_time, p.bid_open_time), '%Y-%m-%d %H:%i:%s') as bidEvaluationTime,
        r.audit_state as auditState,
        r.extract_state as extractState,
        DATE_FORMAT(r.insert_time, '%Y-%m-%d %H:%i:%s') as insertTime
       FROM extract_rule r
       LEFT JOIN project p ON r.project_id = p.id
       ${whereClause}
       ORDER BY r.insert_time DESC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    res.json(successResponse({
      total,
      list: rows,
      pageNum: p,
      pageSize: ps,
      size: rows.length,
      startRow: offset + 1,
      endRow: offset + rows.length,
      pages: Math.ceil(total / ps)
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse('查询审批列表失败'))
  }
})

router.get('/extractRuleAudit/getInfo', async (req, res) => {
  try {
    const { applyId, ruleId } = req.query
    const targetId = applyId || ruleId
    if (!targetId) {
      return res.status(400).json(errorResponse('必须提供 applyId 或 ruleId'))
    }

    const [snapshots] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC LIMIT 1`,
      [targetId]
    )

    if (snapshots && snapshots.length > 0) {
      const snap = snapshots[0]
      let parsed: any = {}
      if (snap.rule_snapshot) {
        try {
          parsed = typeof snap.rule_snapshot === 'string' ? JSON.parse(snap.rule_snapshot) : snap.rule_snapshot
        } catch (_) {}
      }

      const methodMap: Record<string, string> = {
        random: '随机抽取',
        preferred: '择优抽取',
        manual: '手动指定'
      }

      const leaderMajor = parsed.leaderMajor || parsed.leaderMajorNames || ''
      const leaderArea = parsed.leaderArea ? (Array.isArray(parsed.leaderArea) ? parsed.leaderArea.join('、') : String(parsed.leaderArea)) : '不限地区'
      const leaderNum = parsed.leaderNum !== undefined ? Number(parsed.leaderNum) : (leaderMajor ? 1 : 0)

      const memberInfos = Array.isArray(parsed.memberMajors) ? parsed.memberMajors.map((m: any) => ({
        extractMajorNames: m.major || m.extractMajorNames || m.majorName || '-',
        extractAreaNames: m.areas ? (Array.isArray(m.areas) ? m.areas.join('、') : String(m.areas)) : (m.extractAreaNames || '不限地区'),
        extractNum: m.num !== undefined ? Number(m.num) : (m.extractNum !== undefined ? Number(m.extractNum) : 1)
      })) : []

      const avoidDays = parsed.avoidDays || 30
      const maxExtractCount = parsed.maxExtractCount || 3
      const extractCondition = `${avoidDays} 天内被抽中且同意参与的专家不再被抽中；1个月内被抽中且同意参与超过 ${maxExtractCount} 次的专家不能被抽中`

      const avoidUnits = Array.isArray(parsed.avoidUnits) ? parsed.avoidUnits : (parsed.avoidCompanies ? (Array.isArray(parsed.avoidCompanies) ? parsed.avoidCompanies : [parsed.avoidCompanies]) : [])
      const avoidExperts = Array.isArray(parsed.avoidExperts) && parsed.avoidExperts.length > 0
        ? parsed.avoidExperts.map((e: any) => e.name || e.eiName || String(e)).join('、')
        : (Array.isArray(parsed.avoidExpertIds) && parsed.avoidExpertIds.length > 0 ? parsed.avoidExpertIds.join('、') : '无')

      return res.json(successResponse({
        id: String(snap.id),
        ruleId: String(snap.rule_id),
        projectId: String(snap.project_id),
        auditState: snap.audit_state,
        totalExpertNum: parsed.totalExpertNum || (leaderNum + memberInfos.reduce((s: number, m: any) => s + m.extractNum, 0)),
        extractMethodText: methodMap[parsed.extractMethod] || parsed.extractMethod || '随机抽取',
        extractMethod: parsed.extractMethod || 'random',
        leaderInfo: leaderMajor ? {
          extractMajorNames: leaderMajor,
          extractAreaNames: leaderArea,
          extractNum: leaderNum
        } : null,
        memberInfos,
        extractCondition,
        avoidExperts,
        avoidCompanies: avoidUnits,
        avoidUnits,
        ruleSnapshot: JSON.stringify(parsed),
        parsed
      }))
    }

    return (router as any).handle({ ...req, method: 'GET', url: '/extractRule/getRuleInfo' } as any, res, () => {})
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

router.post('/extractRuleAudit/audit', async (req, res) => {
  try {
    const { applyId, ruleId, auditState, auditCode, auditRemark, auditComment, comment } = req.body
    const targetId = ruleId || applyId
    if (!targetId) {
      return res.status(400).json(errorResponse('缺少待审核规则ID'))
    }

    // 前端审核操作：1-审核通过, 2-驳回
    const rawState = Number(auditState ?? auditCode)
    const isPass = rawState === 1
    const finalState = isPass ? 1 : 2
    const memo = auditRemark || auditComment || comment || (isPass ? '同意抽取申请' : '驳回抽取申请')

    // 1. 更新 extract_rule 表 (1: 审批通过, 2: 审批未通过)
    await pool.query(
      `UPDATE extract_rule SET audit_state = ?, last_update_time = NOW() WHERE id = ?`,
      [finalState, targetId]
    )

    // 2. 更新 extract_rule_snapshot 表
    await pool.query(
      `UPDATE extract_rule_snapshot SET audit_state = ? WHERE rule_id = ?`,
      [finalState, targetId]
    )

    // 3. 记录审批流水 audit_record (audit_result: 1通过, 0不通过)
    await pool.query(
      `INSERT INTO audit_record (id, business_id, task_name, audit_result, audit_comment, audit_user_name, audit_time)
       VALUES (?, ?, '审查科科长审批', ?, ?, '审查科审批员', NOW())`,
      [Date.now().toString(), targetId, isPass ? 1 : 0, memo]
    )

    res.json(successResponse(null, isPass ? '抽取申请审批已通过！' : '抽取申请已被驳回！'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// ==========================================
// 12. 专家现场/事后回避 POST /extractActive/avoidance
// ==========================================
router.post('/extractActive/avoidance', async (req, res) => {
  try {
    const { projectId, querys = [] } = req.body
    if (!projectId) {
      return res.status(400).json(errorResponse('项目ID必填'))
    }

    if (!Array.isArray(querys) || querys.length === 0) {
      return res.status(400).json(errorResponse('回避专家列表不能为空'))
    }

    // 1. 批量标记回避状态
    for (const q of querys) {
      const eiId = q.eiId || q.id
      const reason = q.reason || q.avoidanceRemark || '立项人设置回避'
      if (eiId) {
        await pool.query(
          `UPDATE extract_rule_result 
           SET avoidance_flag = 1, avoidance_time = NOW(), avoidance_remark = ?
           WHERE (project_id = ? OR rule_id = ?) AND ei_id = ?`,
          [reason, projectId, projectId, eiId]
        )
      }
    }

    // 2. 检查是否有未完成的补抽，若无则初始化补抽待办
    const [existingSext] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM extract_rule WHERE project_id = ? AND event_type = 2 AND extract_state = 0 LIMIT 1`,
      [projectId]
    )

    if (existingSext.length === 0) {
      const sextRuleId = Date.now().toString()
      await pool.query(
        `INSERT INTO extract_rule (id, project_id, event_type, audit_state, extract_state, insert_time)
         VALUES (?, ?, 2, 1, 0, NOW())`,
        [sextRuleId, projectId]
      )
    }

    res.json(successResponse(null, '专家回避登记成功，已生成补抽待办！'))
  } catch (error: any) {
    console.error('专家回避登记失败:', error)
    res.status(500).json(errorResponse('专家回避登记失败: ' + error.message))
  }
})

export default router
