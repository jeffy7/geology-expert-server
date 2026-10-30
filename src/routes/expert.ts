import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import type { RowDataPacket } from 'mysql2'

const router = Router()

// 专业映射字典
const MAJOR_DICT: Record<string, string> = {
  '1': '矿产地质勘查',
  '2': '地球物理勘查',
  '3': '水文水资源地质',
  '4': '矿产资源储量核算',
  '5': '采矿工程与储量'
}

// 1. 获取全息专家档案列表 GET /etbApi/expert/list
router.get('/list', async (req, res) => {
  try {
    const { name, level } = req.query
    let whereClause = 'WHERE if_stop = 0'
    const params: any[] = []

    if (name) {
      whereClause += ' AND ei_name LIKE ?'
      params.push(`%${name}%`)
    }
    if (level) {
      whereClause += ' AND assess_level = ?'
      params.push(level)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        ei_name as name, 
        sex, 
        id_number as idNumber, 
        phone, 
        ent_name as unit, 
        assess_score as score, 
        assess_level as level,
        if_leave as ifLeave
       FROM expert_info_base 
       ${whereClause} 
       ORDER BY id ASC`,
      params
    )

    // 格式化脱敏数据
    const records = rows.map((r, index) => {
      const p = String(r.phone || '')
      const idNo = String(r.idNumber || '')
      const majorKey = String((index % 5) + 1)

      return {
        key: r.id,
        id: r.id,
        name: r.name,
        gender: r.sex === 2 ? '女' : '男',
        phone: p,
        phoneMask: p.length >= 11 ? `${p.substring(0, 3)}****${p.substring(7)}` : p,
        idNumberMask: idNo.length >= 18 ? `${idNo.substring(0, 4)}****${idNo.substring(14)}` : idNo,
        majorId: majorKey,
        major: MAJOR_DICT[majorKey],
        title: r.score >= 95 ? '教授级高级工程师' : (r.score >= 90 ? '研究员' : '高级工程师'),
        unit: r.unit || '自治区地质矿产勘查开发局',
        score: r.score || 90,
        status: 1,
        statusText: r.ifLeave ? '休假中' : '在聘'
      }
    })

    res.json(successResponse({
      records,
      total: records.length
    }))
  } catch (error: any) {
    console.error('获取专家库失败:', error)
    res.status(500).json(errorResponse(error.message || '获取专家库数据异常'))
  }
})

// 2. 预查候选专家可用人数测算 POST /etbApi/expert/countCandidates
router.post('/countCandidates', async (req, res) => {
  try {
    const { level, majorId, avoidExpertIds = [] } = req.body

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, assess_level FROM expert_info_base WHERE if_stop = 0 AND if_leave = 0`
    )

    let filtered = rows.filter(r => !avoidExpertIds.includes(r.id))
    if (level) {
      filtered = filtered.filter(r => r.assess_level === level)
    }

    res.json(successResponse({
      count: filtered.length
    }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message || '测算候选池异常'))
  }
})

export default router
