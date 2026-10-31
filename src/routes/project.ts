import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

const router = Router()

// 1. 获取项目台账列表 GET /etbApi/project/list
router.get('/list', async (req, res) => {
  try {
    const { projectCode, projectName, extractStatus, page = '1', pageSize = '10' } = req.query
    const p = Math.max(1, parseInt(page as string, 10))
    const ps = Math.max(1, parseInt(pageSize as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (projectCode) {
      whereClause += ' AND project_code LIKE ?'
      params.push(`%${projectCode}%`)
    }
    if (projectName) {
      whereClause += ' AND project_name LIKE ?'
      params.push(`%${projectName}%`)
    }
    if (extractStatus !== undefined && extractStatus !== '') {
      whereClause += ' AND extract_status = ?'
      params.push(Number(extractStatus))
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM biz_project ${whereClause}`,
      params
    )
    const total = countRows[0].total

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        project_code as projectCode, 
        project_name as projectName, 
        declare_unit as declareUnit, 
        explore_unit as exploreUnit, 
        DATE_FORMAT(review_time, '%Y-%m-%d %H:%i') as reviewTime, 
        location, 
        mineral_type as mineralType, 
        audit_status as auditStatus, 
        extract_status as extractStatus,
        expert_count as expertCount,
        confirmed_count as confirmedCount,
        create_by as createBy,
        DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') as createTime
       FROM biz_project 
       ${whereClause} 
       ORDER BY id DESC 
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    // 映射状态名称
    const records = rows.map(r => ({
      ...r,
      auditStatusName: r.auditStatus === 1 ? '已审核' : (r.auditStatus === 2 ? '已驳回' : '未审核'),
      status: r.extractStatus,
      statusName: r.extractStatus === 2 ? '已抽取' : (r.extractStatus === 1 ? '抽取中' : '未抽取'),
      extractStatusName: r.extractStatus === 2 ? '已抽取' : (r.extractStatus === 1 ? '抽取中' : '未抽取')
    }))

    res.json(successResponse({
      records,
      total,
      current: p,
      size: ps
    }))
  } catch (error: any) {
    console.error('查询项目列表失败:', error)
    res.status(500).json(errorResponse(error.message || '查询项目列表异常'))
  }
})

// 2. 获取项目详情 GET /etbApi/project/detail/:id (兼容兜底重定向到 expert-system)
router.get('/detail/:id', async (req, res) => {
  try {
    const id = req.params.id
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM project WHERE id = ? OR project_no = ?`,
      [id, id]
    )

    if (rows.length === 0) {
      res.status(404).json(errorResponse('项目不存在', 404))
      return
    }

    const r = rows[0]
    // 查回避专家
    const [avoidRows] = await pool.query<RowDataPacket[]>(
      `SELECT expert_id FROM biz_project_avoid_expert WHERE project_id = ?`,
      [r.id]
    )
    const avoidExpertIds = avoidRows.map(row => row.expert_id)

    // 查预抽规则
    const [ruleRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM biz_project_extract_rule WHERE project_id = ?`,
      [r.id]
    )
    const rule = ruleRows[0] || null

    res.json(successResponse({
      ...r,
      id: String(r.id),
      avoidExpertIds,
      rule: rule ? {
        totalExpertCount: rule.total_expert_count,
        backupRatio: rule.backup_ratio,
        leaderLevel: rule.leader_level,
        leaderMajorId: rule.leader_major_id,
        memberRules: rule.member_rules_json ? JSON.parse(rule.member_rules_json) : []
      } : null
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '获取项目详情异常'))
  }
})

// 3. 新建或修改项目申报 POST /etbApi/project/save
router.post('/save', async (req, res) => {
  try {
    const data = req.body
    if (data.id) {
      // 更新
      await pool.query<ResultSetHeader>(
        `UPDATE biz_project SET 
          project_name = ?, 
          declare_unit = ?, 
          explore_unit = ?, 
          review_time = ?, 
          location = ?, 
          mineral_type = ?, 
          remark = ?
         WHERE id = ?`,
        [
          data.projectName,
          data.declareUnit,
          data.exploreUnit || '',
          data.reviewTime,
          data.location || '自治区储量评审中心会议室',
          Number(data.mineralType) || 1,
          data.remark || '',
          data.id
        ]
      )
      res.json(successResponse({ id: data.id }, '项目修改成功'))
      return
    }

    // 新增
    const projectCode = data.projectCode || `NM-KC-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO biz_project 
        (project_code, project_name, declare_unit, explore_unit, review_time, location, mineral_type, remark, audit_status, extract_status, expert_count, confirmed_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 5, 0)`,
      [
        projectCode,
        data.projectName,
        data.declareUnit,
        data.exploreUnit || '',
        data.reviewTime,
        data.location || '自治区储量评审中心会议室',
        Number(data.mineralType) || 1,
        data.remark || ''
      ]
    )

    res.json(successResponse({ id: result.insertId, projectCode }, '项目申报创建成功'))
  } catch (error: any) {
    console.error('保存项目失败:', error)
    res.status(500).json(errorResponse(error.message || '保存项目异常'))
  }
})

// 4. 保存回避专家穿梭框设置 POST /etbApi/project/saveAvoidExperts
router.post('/saveAvoidExperts', async (req, res) => {
  try {
    const { projectId, avoidExpertIds = [] } = req.body
    if (!projectId) {
      res.status(400).json(errorResponse('项目ID必填', 400))
      return
    }

    // 先删除已有的回避设置
    await pool.query('DELETE FROM biz_project_avoid_expert WHERE project_id = ?', [projectId])

    // 重新写入
    if (avoidExpertIds.length > 0) {
      const values = avoidExpertIds.map((eid: number) => [projectId, eid])
      await pool.query('INSERT INTO biz_project_avoid_expert (project_id, expert_id) VALUES ?', [values])
    }

    res.json(successResponse({ count: avoidExpertIds.length }, '回避专家配置已保存'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '保存回避专家失败'))
  }
})

// 5. 保存预查条件与抽取规则 POST /etbApi/project/saveExtractRule
router.post('/saveExtractRule', async (req, res) => {
  try {
    const { projectId, totalExpertCount, backupRatio, leaderLevel, leaderMajor, memberRules } = req.body
    if (!projectId) {
      res.status(400).json(errorResponse('项目ID必填', 400))
      return
    }

    const memberJson = JSON.stringify(memberRules || [])
    await pool.query(
      `INSERT INTO biz_project_extract_rule 
        (project_id, total_expert_count, backup_ratio, leader_level, leader_major_id, member_rules_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        total_expert_count = VALUES(total_expert_count),
        backup_ratio = VALUES(backup_ratio),
        leader_level = VALUES(leader_level),
        leader_major_id = VALUES(leader_major_id),
        member_rules_json = VALUES(member_rules_json)`,
      [projectId, totalExpertCount || 5, backupRatio || 2, leaderLevel || 'province', leaderMajor || '1', memberJson]
    )

    // 更新项目目标人数并送审
    await pool.query(
      `UPDATE biz_project SET expert_count = ?, audit_status = 0 WHERE id = ?`,
      [totalExpertCount || 5, projectId]
    )

    res.json(successResponse({ projectId }, '抽签条件已保存并送审审查科！'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '保存抽签条件失败'))
  }
})

export default router
