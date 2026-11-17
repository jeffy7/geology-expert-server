import { Router } from 'express'
import { pool } from '../config/db'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { successResponse, errorResponse } from '../types'
import { authenticateToken } from '../middleware/auth'
import { hashPassword } from '../services/rbacService'
import { MASTER_MENU_TREE } from '../constants/masterMenus'

const router = Router()

// 全量菜单树结构获取（供角色授权弹窗 el-tree 勾选）
router.get('/menu/tree', authenticateToken, (req, res) => {
  res.json(successResponse(MASTER_MENU_TREE))
})

// ==================== 1. 用户管理 ====================

// 1.1 用户列表 (支持分页与模糊搜索)
router.get('/user/list', authenticateToken, async (req, res) => {
  try {
    const current = Math.max(1, Number(req.query.current) || 1)
    const size = Math.max(1, Number(req.query.size) || 10)
    const offset = (current - 1) * size

    const username = (req.query.username as string)?.trim()
    const realName = (req.query.realName as string)?.trim()
    const status = req.query.status !== undefined && req.query.status !== '' ? Number(req.query.status) : undefined

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (username) {
      whereClause += ' AND u.username LIKE ?'
      params.push(`%${username}%`)
    }
    if (realName) {
      whereClause += ' AND u.real_name LIKE ?'
      params.push(`%${realName}%`)
    }
    if (status !== undefined) {
      whereClause += ' AND u.status = ?'
      params.push(status)
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM sys_user u ${whereClause}`,
      params
    )
    const total = Number(countRows[0]?.total || 0)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        u.id, 
        u.username, 
        u.real_name as realName, 
        u.department, 
        u.phone, 
        u.status, 
        u.is_system as isSystem,
        u.create_time as createTime,
        r.id as roleId,
        r.role_key as roleKey,
        r.role_name as roleName
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON u.id = ur.user_id
       LEFT JOIN sys_role r ON ur.role_id = r.id
       ${whereClause}
       ORDER BY u.id ASC
       LIMIT ? OFFSET ?`,
      [...params, size, offset]
    )

    res.json(
      successResponse({
        total,
        records: rows,
        current,
        size
      })
    )
  } catch (error: any) {
    res.status(500).json(errorResponse('获取用户列表失败: ' + error.message))
  }
})

// 1.2 新增或编辑用户
router.post('/user/save', authenticateToken, async (req, res) => {
  try {
    const { id, username, password, realName, department, phone, status, roleId } = req.body

    if (!username || !realName) {
      res.status(400).json(errorResponse('登录账号和姓名不能为空'))
      return
    }

    if (id) {
      // 编辑
      await pool.query(
        `UPDATE sys_user 
         SET real_name = ?, department = ?, phone = ?, status = ?
         WHERE id = ?`,
        [realName, department || '', phone || '', status ?? 1, id]
      )

      if (roleId) {
        await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [id])
        await pool.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [id, roleId])
      }

      res.json(successResponse(null, '更新用户信息成功'))
    } else {
      // 新增
      const [exist] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE username = ?', [username.trim()])
      if (exist.length > 0) {
        res.status(400).json(errorResponse('该登录账号已存在，请更换'))
        return
      }

      const initialPassword = password?.trim() || '123456'
      const pwdHash = hashPassword(initialPassword)

      const [insertRes] = await pool.query<ResultSetHeader>(
        `INSERT INTO sys_user (username, password, real_name, department, phone, status, is_system)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [username.trim(), pwdHash, realName.trim(), department || '', phone || '', status ?? 1]
      )

      const newUserId = insertRes.insertId
      if (roleId) {
        await pool.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [newUserId, roleId])
      }

      res.json(successResponse({ id: newUserId }, '创建用户成功'))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('保存用户失败: ' + error.message))
  }
})

// 1.3 重置/修改用户密码
router.post('/user/changePassword', authenticateToken, async (req, res) => {
  try {
    const { userId, newPassword } = req.body
    if (!userId || !newPassword) {
      res.status(400).json(errorResponse('用户ID与新密码不能为空'))
      return
    }

    const pwdHash = hashPassword(newPassword.trim())
    await pool.query('UPDATE sys_user SET password = ? WHERE id = ?', [pwdHash, userId])

    res.json(successResponse(null, '密码修改成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('修改密码失败: ' + error.message))
  }
})

// 1.4 删除用户
router.delete('/user/:id', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.params.id)
    const [uRows] = await pool.query<RowDataPacket[]>('SELECT is_system, username FROM sys_user WHERE id = ?', [userId])
    if (uRows.length === 0) {
      res.status(404).json(errorResponse('用户不存在'))
      return
    }

    if (uRows[0].is_system === 1 || uRows[0].username === 'admin') {
      res.status(403).json(errorResponse('系统内置核心账号不可删除'))
      return
    }

    await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [userId])
    await pool.query('DELETE FROM sys_user WHERE id = ?', [userId])

    res.json(successResponse(null, '删除用户成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('删除用户失败: ' + error.message))
  }
})

// ==================== 2. 角色与权限管理 ====================

// 2.1 角色列表
router.get('/role/list', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT 
        r.id, 
        r.role_key as roleKey, 
        r.role_name as roleName, 
        r.description, 
        r.status, 
        r.is_system as isSystem, 
        r.create_time as createTime,
        (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.role_id = r.id) as userCount,
        (SELECT COUNT(*) FROM sys_role_menu rm WHERE rm.role_id = r.id) as menuCount
      FROM sys_role r
      ORDER BY r.id ASC
    `)

    res.json(successResponse(rows))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取角色列表失败: ' + error.message))
  }
})

// 2.2 新增或编辑角色
router.post('/role/save', authenticateToken, async (req, res) => {
  try {
    const { id, roleKey, roleName, description, status } = req.body

    if (!roleName) {
      res.status(400).json(errorResponse('角色名称不能为空'))
      return
    }

    if (id) {
      // 编辑
      await pool.query(
        `UPDATE sys_role SET role_name = ?, description = ?, status = ? WHERE id = ?`,
        [roleName.trim(), description || '', status ?? 1, id]
      )
      res.json(successResponse(null, '更新角色成功'))
    } else {
      // 新增
      const finalKey = (roleKey || 'role_' + Date.now()).trim()
      const [exist] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_role WHERE role_key = ?', [finalKey])
      if (exist.length > 0) {
        res.status(400).json(errorResponse('角色标识已存在，请更换'))
        return
      }

      const [insertRes] = await pool.query<ResultSetHeader>(
        `INSERT INTO sys_role (role_key, role_name, description, status, is_system)
         VALUES (?, ?, ?, ?, 0)`,
        [finalKey, roleName.trim(), description || '', status ?? 1]
      )

      res.json(successResponse({ id: insertRes.insertId }, '创建角色成功'))
    }
  } catch (error: any) {
    res.status(500).json(errorResponse('保存角色失败: ' + error.message))
  }
})

// 2.3 获取指定角色已授权的菜单ID列表
router.get('/role/menuIds/:roleId', authenticateToken, async (req, res) => {
  try {
    const roleId = Number(req.params.roleId)
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT menu_id as menuId FROM sys_role_menu WHERE role_id = ?',
      [roleId]
    )
    const menuIds = rows.map((r: any) => Number(r.menuId))
    res.json(successResponse(menuIds))
  } catch (error: any) {
    res.status(500).json(errorResponse('获取角色菜单权限失败: ' + error.message))
  }
})

// 2.4 保存指定角色的菜单权限
router.post('/role/assignMenus', authenticateToken, async (req, res) => {
  try {
    const { roleId, menuIds } = req.body
    if (!roleId) {
      res.status(400).json(errorResponse('角色ID不能为空'))
      return
    }

    const ids: number[] = Array.isArray(menuIds) ? menuIds.map(Number) : []

    // 清空现有授权并重新写入
    await pool.query('DELETE FROM sys_role_menu WHERE role_id = ?', [roleId])

    for (const mid of ids) {
      await pool.query('INSERT INTO sys_role_menu (role_id, menu_id) VALUES (?, ?)', [roleId, mid])
    }

    res.json(successResponse(null, '权限配置保存成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('分配菜单权限失败: ' + error.message))
  }
})

// 2.5 删除角色
router.delete('/role/:id', authenticateToken, async (req, res) => {
  try {
    const roleId = Number(req.params.id)
    const [rRows] = await pool.query<RowDataPacket[]>('SELECT is_system FROM sys_role WHERE id = ?', [roleId])
    if (rRows.length === 0) {
      res.status(404).json(errorResponse('角色不存在'))
      return
    }

    if (rRows[0].is_system === 1) {
      res.status(403).json(errorResponse('系统内置核心角色不可删除'))
      return
    }

    // 检查是否有用户关联
    const [uRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as cnt FROM sys_user_role WHERE role_id = ?', [roleId])
    if (Number(uRows[0]?.cnt || 0) > 0) {
      res.status(400).json(errorResponse('该角色下尚有关联用户，请先解绑用户后再删除'))
      return
    }

    await pool.query('DELETE FROM sys_role_menu WHERE role_id = ?', [roleId])
    await pool.query('DELETE FROM sys_role WHERE id = ?', [roleId])

    res.json(successResponse(null, '删除角色成功'))
  } catch (error: any) {
    res.status(500).json(errorResponse('删除角色失败: ' + error.message))
  }
})

export default router
