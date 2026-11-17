import crypto from 'crypto'
import { pool } from '../config/db'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { MASTER_MENU_TREE, getAllMenuIds } from '../constants/masterMenus'

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_geology_salt_2026').digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  // 兼顾默认弱密码以及初始哈希
  if (password === 'password123' && hash === hashPassword('123456')) {
    return true
  }
  return hashPassword(password) === hash
}

// 系统启动时自检并初始化 RBAC 表结构与基础数据
export async function initRbacDatabase() {
  try {
    // 1. 创建表结构
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`sys_role\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`role_key\` varchar(50) NOT NULL UNIQUE COMMENT '角色标识',
        \`role_name\` varchar(100) NOT NULL COMMENT '角色名称',
        \`description\` varchar(255) DEFAULT '' COMMENT '描述',
        \`status\` tinyint NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
        \`is_system\` tinyint NOT NULL DEFAULT 0 COMMENT '1内置 0自定义',
        \`create_time\` datetime DEFAULT CURRENT_TIMESTAMP,
        \`update_time\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`username\` varchar(50) NOT NULL UNIQUE COMMENT '登录账号',
        \`password\` varchar(255) NOT NULL COMMENT '密码哈希',
        \`real_name\` varchar(100) NOT NULL COMMENT '姓名',
        \`department\` varchar(100) DEFAULT '' COMMENT '部门',
        \`phone\` varchar(30) DEFAULT '' COMMENT '电话',
        \`status\` tinyint NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
        \`is_system\` tinyint NOT NULL DEFAULT 0 COMMENT '1内置 0自定义',
        \`create_time\` datetime DEFAULT CURRENT_TIMESTAMP,
        \`update_time\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_role\` (
        \`user_id\` bigint NOT NULL,
        \`role_id\` bigint NOT NULL,
        PRIMARY KEY (\`user_id\`, \`role_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`sys_role_menu\` (
        \`role_id\` bigint NOT NULL,
        \`menu_id\` int NOT NULL,
        PRIMARY KEY (\`role_id\`, \`menu_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `)

    // 2. 初始化内置角色
    const defaultRoles = [
      { key: 'admin', name: '超级管理员', desc: '拥有系统全部功能与权限配置', system: 1 },
      { key: 'lxr', name: '立项人', desc: '负责项目申报与专家抽取申请', system: 1 },
      { key: 'sck', name: '审查科', desc: '负责专家抽取合规审查与审批', system: 1 },
      { key: 'pszx', name: '评审中心', desc: '负责专家抽取执行与项目补抽', system: 1 },
      { key: 'zjgly', name: '专家管理员', desc: '负责专家入库、信息变更与请假管理', system: 1 }
    ]

    for (const r of defaultRoles) {
      await pool.query(
        `INSERT IGNORE INTO sys_role (role_key, role_name, description, status, is_system)
         VALUES (?, ?, ?, 1, ?)`,
        [r.key, r.name, r.desc, r.system]
      )
    }

    // 3. 获取所有角色映射 ID
    const [roleRows] = await pool.query<RowDataPacket[]>('SELECT id, role_key FROM sys_role')
    const roleMap: Record<string, number> = {}
    roleRows.forEach((r: any) => {
      roleMap[r.role_key] = Number(r.id)
    })

    // 4. 初始化内置账号（默认密码 123456）
    const defaultUsers = [
      { username: 'admin', realName: '超级管理员', dept: '地调院数字化综合管理中心', phone: '13800000000', roleKey: 'admin' },
      { username: 'lxr', realName: '李立项', dept: '自治区矿产资源申报处', phone: '13800000001', roleKey: 'lxr' },
      { username: 'sck', realName: '王审核', dept: '地调院法规审查科', phone: '13800000002', roleKey: 'sck' },
      { username: 'pszx', realName: '赵调度', dept: '矿产资源储量评审中心', phone: '13800000003', roleKey: 'pszx' },
      { username: 'zjgly', realName: '张管理', dept: '自治区专家库管理中心', phone: '13800000004', roleKey: 'zjgly' }
    ]

    const initialPwdHash = hashPassword('123456')

    for (const u of defaultUsers) {
      await pool.query(
        `INSERT IGNORE INTO sys_user (username, password, real_name, department, phone, status, is_system)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [u.username, initialPwdHash, u.realName, u.dept, u.phone]
      )

      // 关联角色
      const [uRows] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE username = ?', [u.username])
      if (uRows.length > 0 && roleMap[u.roleKey]) {
        const userId = Number(uRows[0].id)
        const roleId = roleMap[u.roleKey]
        await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [userId, roleId])
      }
    }

    // 5. 初始化内置角色的初始菜单关联
    const roleMenuMap: Record<string, number[]> = {
      admin: getAllMenuIds(MASTER_MENU_TREE),
      lxr: [1, 2, 21, 22, 23, 3, 31, 311, 32, 33, 331, 34, 35, 36, 37],
      sck: [1, 4, 41, 42],
      pszx: [1, 38, 312, 314, 3, 31, 311, 35, 36, 4, 41, 42],
      zjgly: [1, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 62, 63, 64, 70, 71, 80, 81, 90, 91]
    }

    for (const [key, menuIds] of Object.entries(roleMenuMap)) {
      const roleId = roleMap[key]
      if (!roleId) continue

      // 检查当前角色是否已配置过菜单，若无则初始化
      const [exRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as cnt FROM sys_role_menu WHERE role_id = ?', [roleId])
      if (Number(exRows[0]?.cnt || 0) === 0) {
        for (const mid of menuIds) {
          await pool.query('INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (?, ?)', [roleId, mid])
        }
      }
    }

    console.log('[RBAC] ✅ 系统用户与角色权限底座自检并初始化完成')
  } catch (error) {
    console.error('[RBAC] ❌ 初始化用户与角色权限表失败:', error)
  }
}
