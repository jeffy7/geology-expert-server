import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../config/db'
import { RowDataPacket } from 'mysql2'
import { successResponse, errorResponse } from '../types'
import { JWT_SECRET, authenticateToken } from '../middleware/auth'
import { MASTER_MENU_TREE, filterMenuTree } from '../constants/masterMenus'
import { verifyPassword } from '../services/rbacService'

const router = Router()

// 系统四大核心角色预置档案 + admin 超级管理员
export const SYSTEM_ROLES: Record<string, { roleId: string; roleName: string; realName: string; department: string }> = {
  admin: { roleId: 'IdentityRole_Admin', roleName: '超级管理员', realName: '超级管理员', department: '地调院数字化综合管理中心' },
  lxr: { roleId: 'IdentityRole_33', roleName: '立项人', realName: '李立项', department: '自治区矿产资源申报处' },
  sck: { roleId: 'IdentityRole_34', roleName: '审查科', realName: '王审核', department: '地调院法规审查科' },
  pszx: { roleId: 'IdentityRole_35', roleName: '评审中心', realName: '赵调度', department: '矿产资源储量评审中心' },
  zjgly: { roleId: 'IdentityRole_36', roleName: '专家管理员', realName: '张管理', department: '自治区专家库管理中心' }
}

const generateUserToken = (userKey: string) => {
  const matchedUser = SYSTEM_ROLES[userKey] || SYSTEM_ROLES['lxr']
  return jwt.sign(
    {
      sub: matchedUser.roleId,
      aud: 'geology-expert-system',
      username: userKey,
      role: matchedUser.roleName,
      roleId: matchedUser.roleId,
      realName: matchedUser.realName
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

// 1. 用户登录 POST /etbApi/etbuser/login (支持真实数据库用户与密码校验，兼顾兼容模式)
router.post('/login', async (req, res) => {
  const { username, password, identity } = req.body
  const loginUser = (username || identity || 'lxr').trim()

  try {
    // 1. 查询系统用户表
    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.password, u.real_name as realName, u.department, u.phone, u.status,
              r.id as roleId, r.role_key as roleKey, r.role_name as roleName
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON u.id = ur.user_id
       LEFT JOIN sys_role r ON ur.role_id = r.id
       WHERE u.username = ?`,
      [loginUser]
    )

    if (userRows.length > 0) {
      const user = userRows[0]
      if (user.status === 0) {
        res.status(403).json(errorResponse('该账号已被禁用，请联系系统管理员'))
        return
      }

      // 密码校验 (如传了密码则校验)
      if (password) {
        const isMatch = verifyPassword(password, user.password)
        if (!isMatch) {
          res.status(400).json(errorResponse('密码错误，请重新输入'))
          return
        }
      }

      const roleKey = user.roleKey || 'lxr'
      const roleIdStr = SYSTEM_ROLES[roleKey]?.roleId || `IdentityRole_${user.roleId || roleKey}`
      const roleName = user.roleName || SYSTEM_ROLES[roleKey]?.roleName || '业务人员'

      const token = jwt.sign(
        {
          sub: roleIdStr,
          aud: 'geology-expert-system',
          username: user.username,
          userId: user.id,
          role: roleName,
          roleId: roleIdStr,
          roleKey: roleKey,
          realName: user.realName
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      )

      res.json(
        successResponse({
          access_token: token,
          token_type: 'Bearer',
          expires_in: 604800,
          user_info: {
            username: user.username,
            userId: user.id,
            roleId: roleIdStr,
            roleKey: roleKey,
            roleName: roleName,
            realName: user.realName,
            department: user.department
          }
        }, '登录成功')
      )
      return
    }

    // 2. 兜底未入库账号：按预设角色快速通过
    const matchedUser = SYSTEM_ROLES[loginUser] || SYSTEM_ROLES['lxr']
    const token = generateUserToken(loginUser)

    res.json(
      successResponse({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 604800,
        user_info: {
          username: loginUser,
          roleId: matchedUser.roleId,
          roleName: matchedUser.roleName,
          realName: matchedUser.realName,
          department: matchedUser.department
        }
      }, '登录成功')
    )
  } catch (error: any) {
    console.error('[Auth] 登录处理异常:', error)
    res.status(500).json(errorResponse('登录处理异常: ' + error.message))
  }
})

// 2. 获取当前登录用户信息 GET /etbApi/etbuser/info
router.get('/info', authenticateToken, async (req, res) => {
  if (!req.user) {
    res.status(401).json(errorResponse('身份未验证', 401))
    return
  }
  try {
    const [uRows] = await pool.query<RowDataPacket[]>(
      `SELECT u.username, u.real_name as realName, u.department, r.role_name as roleName, r.role_key as roleKey, r.id as roleId
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON u.id = ur.user_id
       LEFT JOIN sys_role r ON ur.role_id = r.id
       WHERE u.username = ?`,
      [req.user.username]
    )

    if (uRows.length > 0) {
      const u = uRows[0]
      const roleIdStr = SYSTEM_ROLES[u.roleKey]?.roleId || `IdentityRole_${u.roleId || u.roleKey}`
      res.json(
        successResponse({
          username: u.username,
          roleId: roleIdStr,
          roleKey: u.roleKey,
          roleName: u.roleName || '业务人员',
          realName: u.realName,
          department: u.department
        })
      )
      return
    }
  } catch (e) {
    // 降级使用 token 缓存信息
  }

  const matchedUser = SYSTEM_ROLES[req.user.username] || SYSTEM_ROLES['lxr']
  res.json(
    successResponse({
      username: req.user.username,
      roleId: matchedUser.roleId,
      roleName: matchedUser.roleName,
      realName: matchedUser.realName,
      department: matchedUser.department
    })
  )
})

// 3. 动态角色菜单树 GET /etbApi/etbuser/identity/identityRoleMenuList
router.get('/identity/identityRoleMenuList', async (req, res) => {
  const identityRole = (req.headers['identityrole'] as string) || 'IdentityRole_33'

  try {
    let roleKey = identityRole
    for (const [k, v] of Object.entries(SYSTEM_ROLES)) {
      if (v.roleId === identityRole) {
        roleKey = k
        break
      }
    }

    // 查询角色在 sys_role 中的授权菜单
    const [roleRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.role_key FROM sys_role r WHERE r.role_key = ? OR CAST(r.id AS CHAR) = ? OR CONCAT('IdentityRole_', r.id) = ?`,
      [roleKey, identityRole, identityRole]
    )

    if (roleRows.length > 0) {
      const roleId = roleRows[0].id
      const [menuRows] = await pool.query<RowDataPacket[]>(
        `SELECT menu_id as menuId FROM sys_role_menu WHERE role_id = ?`,
        [roleId]
      )

      if (menuRows.length > 0) {
        const allowedIds = new Set<number>(menuRows.map((m: any) => Number(m.menuId)))
        // 始终保留工作台首页 (1)
        allowedIds.add(1)
        const dynamicMenus = filterMenuTree(MASTER_MENU_TREE, allowedIds)
        res.json(successResponse(dynamicMenus))
        return
      }
    }
  } catch (error) {
    console.warn('[Auth] 读取角色动态菜单失败，降级至预置规则:', error)
  }

  // 通用首页
  const menus: any[] = [
    {
      id: 1,
      name: 'Dashboard',
      path: '/dashboard',
      component: 'dashboard/index',
      meta: { title: '工作台首页', icon: 'Odometer' }
    }
  ]

  // 按角色分发菜单
  if (identityRole === 'IdentityRole_33') {
    // 立项人 (lxr) - 严格 1:1 对齐 HAR 真实菜单树
    menus.push(
      {
        id: 2,
        name: 'ProjectManage',
        path: '/projectManage',
        redirect: '/projectManage/list',
        meta: { title: '项目管理', icon: 'FolderOpened' },
        children: [
          {
            id: 21,
            name: 'ProjectList',
            path: 'list',
            component: 'project/list',
            meta: { title: '项目列表' }
          },
          {
            id: 22,
            name: 'ProjectEdit',
            path: 'edit',
            component: 'project/edit',
            meta: { title: '项目申报录入', hidden: true }
          },
          {
            id: 23,
            name: 'ProjectDetail',
            path: 'detail',
            component: 'project/detail',
            meta: { title: '项目详情查看', hidden: true }
          }
        ]
      },
      {
        id: 3,
        name: 'ExpertExtract',
        path: '/expertExtract',
        redirect: '/expertExtract/extract/list',
        meta: { title: '专家抽取管理', icon: 'UserFilled' },
        children: [
          {
            id: 31,
            name: 'ExtractManage',
            path: '/expertExtract/extract',
            redirect: '/expertExtract/extract/list',
            meta: { title: '抽取管理' },
            children: [
              {
                id: 311,
                name: 'ExtractList',
                path: 'list',
                component: 'extract/list',
                meta: { title: '列表' }
              }
            ]
          },
          {
            id: 32,
            name: 'ExtractionApplication',
            path: '/extractionApplication',
            component: 'extract/list',
            meta: { title: '抽取申请管理' }
          },
          {
            id: 33,
            name: 'PreExtractManage',
            path: '/expertExtract/preExtract',
            redirect: '/expertExtract/preExtract/list',
            meta: { title: '专家预抽取管理' },
            children: [
              {
                id: 331,
                name: 'PreExtractList',
                path: 'list',
                component: 'extract/preList',
                meta: { title: '列表' }
              }
            ]
          },
          {
            id: 34,
            name: 'PreExtractPreview',
            path: 'preExtract/preview',
            component: 'extract/prePreview',
            meta: { title: '预查条件与回避设置', hidden: true }
          },
          {
            id: 35,
            name: 'ExtractDetail',
            path: 'extract/detail',
            component: 'extract/detail',
            meta: { title: '查看', hidden: true }
          },
          {
            id: 36,
            name: 'ExtractExecute',
            path: 'extract/extract',
            component: 'extract/extract',
            meta: { title: '抽取列表', hidden: true }
          },
          {
            id: 37,
            name: 'ExtractApplication',
            path: 'extract/application',
            component: 'extract/application',
            meta: { title: '抽取申请', hidden: true }
          }
        ]
      },
      {
        id: 6,
        name: 'EvaluationAndAssessment',
        path: '/evaluationAndAssessment',
        redirect: '/evaluationAndAssessment/evaluationByJudges',
        meta: { title: '评价与考核', icon: 'DocumentChecked' },
        children: [
          {
            id: 61,
            name: 'EvaluationByJudges',
            path: 'evaluationByJudges',
            component: 'evaluation/evaluationByJudges',
            meta: { title: '评委评价' }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_34') {
    // 审查科 (sck)
    menus.push(
      {
        id: 4,
        name: 'Supervision',
        path: '/supervision',
        redirect: '/supervision/jurySelection',
        meta: { title: '抽取审批管理', icon: 'Checked' },
        children: [
          {
            id: 41,
            name: 'JurySelection',
            path: 'jurySelection',
            component: 'supervision/jurySelection',
            meta: { title: '评委抽取审批' }
          },
          {
            id: 42,
            name: 'AuditAndCheck',
            path: '/auditAndCheck',
            component: 'supervision/auditAndCheck',
            meta: { title: '审核查看', hidden: true }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_35') {
    // 评审中心 (pszx) - 1:1 对齐 HAR 与真实截屏
    menus.push(
      {
        id: 31,
        name: 'ExpertExtractionRecord',
        path: '/expertExtractionRecord',
        redirect: '/expertExtract/extract/list',
        meta: { title: '专家抽取记录', icon: 'UserFilled' },
        children: [
          {
            id: 311,
            name: 'ExtractList',
            path: '/expertExtract/extract/list',
            component: 'extract/list',
            meta: { title: '抽取管理' }
          },
          {
            id: 312,
            name: 'SupplementList',
            path: '/expertExtract/supplement/list',
            component: 'extract/supplementList',
            meta: { title: '项目补抽' }
          },
          {
            id: 313,
            name: 'ExtractDetail',
            path: '/expertExtract/extract/detail',
            component: 'extract/detail',
            meta: { title: '抽取详情', hidden: true }
          },
          {
            id: 314,
            name: 'SupplementDetail',
            path: '/expertExtract/supplement/detail',
            component: 'extract/supplementDetail',
            meta: { title: '项目补抽详情', hidden: true }
          },
          {
            id: 315,
            name: 'ExtractExecute',
            path: '/expertExtract/extract/extract',
            component: 'extract/detail',
            meta: { title: '专家抽取执行', hidden: true }
          }
        ]
      },
      {
        id: 32,
        name: 'ExtractionAndApproval',
        path: '/supervision',
        redirect: '/supervision/jurySelection',
        meta: { title: '抽取审批管理', icon: 'Checked' },
        children: [
          {
            id: 321,
            name: 'JurySelection',
            path: 'jurySelection',
            component: 'supervision/jurySelection',
            meta: { title: '评委抽取审批' }
          },
          {
            id: 322,
            name: 'AuditAndCheck',
            path: '/auditAndCheck',
            component: 'supervision/auditAndCheck',
            meta: { title: '审核查看', hidden: true }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_36') {
    // 专家管理员 (zjgly) - 1:1 对齐 HAR 与真实截屏全息菜单
    menus.push(
      {
        id: 50,
        name: 'ExpertDatabaseManagement',
        path: '/expertDatabaseManagement',
        redirect: '/infoManagement/list',
        meta: { title: '专家库管理', icon: 'Management' },
        children: [
          {
            id: 51,
            name: 'ChangeApprovalList',
            path: '/changeApproval/list',
            component: 'expert/changeList',
            meta: { title: '专家信息变更审批' }
          },
          {
            id: 52,
            name: 'ExpertInfoList',
            path: '/infoManagement/list',
            component: 'expert/list',
            meta: { title: '专家库信息管理' }
          },
          {
            id: 53,
            name: 'VacateList',
            path: '/vacate/list',
            component: 'expert/vacate',
            meta: { title: '专家请假管理' }
          },
          {
            id: 54,
            name: 'ProfessionalManagement',
            path: '/professionalManagement',
            component: 'expert/professionalManagement',
            meta: { title: '专家专业管理' }
          },
          {
            id: 55,
            name: 'ExpertTitleManagement',
            path: '/expertTItleManagement',
            component: 'expert/titleManagement',
            meta: { title: '专家职称管理' }
          },
          {
            id: 56,
            name: 'ExpertExpertise',
            path: '/expertExpertise',
            component: 'expert/expertiseManagement',
            meta: { title: '专家所学专业管理' }
          },
          {
            id: 57,
            name: 'ExpertEducation',
            path: '/expertEducation',
            component: 'expert/educationManagement',
            meta: { title: '专家学历管理' }
          },
          {
            id: 58,
            name: 'ScoringSituation',
            path: '/infoManagement/scoringSituation',
            component: 'expert/scoring',
            meta: { title: '计分情况', hidden: true }
          },
          {
            id: 59,
            name: 'ExpertViolation',
            path: '/infoManagement/expertViolation',
            component: 'expert/violation',
            meta: { title: '专家违规情况', hidden: true }
          },
          {
            id: 60,
            name: 'ChangeApprovalView',
            path: '/changeApproval/view',
            component: 'expert/changeView',
            meta: { title: '信息变更查看', hidden: true }
          },
          {
            id: 63,
            name: 'InfoManagementView',
            path: '/infoManagement/view',
            component: 'expert/infoView',
            meta: { title: '专家信息查看', hidden: true }
          },
          {
            id: 64,
            name: 'InfoManagementEdit',
            path: '/infoManagement/edit',
            component: 'expert/infoEdit',
            meta: { title: '专家信息编辑', hidden: true }
          },
          {
            id: 62,
            name: 'AuditVacate',
            path: '/auditVacate',
            component: 'expert/auditVacate',
            meta: { title: '请假审核', hidden: true }
          }
        ]
      },
      {
        id: 70,
        name: 'EvaluationAndAssessment',
        path: '/evaluationAndAssessment',
        redirect: '/evaluate',
        meta: { title: '评价与考核', icon: 'DocumentChecked' },
        children: [
          {
            id: 71,
            name: 'EvaluationByJudges',
            path: '/evaluate',
            component: 'evaluation/evaluationByJudges',
            meta: { title: '评委评价' }
          }
        ]
      },
      {
        id: 80,
        name: 'ProjectDictionaries',
        path: '/projectDictionaries',
        redirect: '/dictionariesView',
        meta: { title: '项目字典管理', icon: 'Collection' },
        children: [
          {
            id: 81,
            name: 'DictionariesView',
            path: '/dictionariesView',
            component: 'dict/dictionariesView',
            meta: { title: '项目字典' }
          }
        ]
      },
      {
        id: 90,
        name: 'SystemTools',
        path: '/systemTools',
        redirect: '/SMSSending',
        meta: { title: '系统工具', icon: 'Tools' },
        children: [
          {
            id: 91,
            name: 'SMSSending',
            path: '/SMSSending',
            component: 'tool/smsSending',
            meta: { title: '短信群发' }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_Admin') {
    // 超级管理员 (admin) - 拥有系统全部模块的全景菜单
    menus.push(
      // 1. 项目管理
      {
        id: 2,
        name: 'ProjectManage',
        path: '/projectManage',
        redirect: '/projectManage/list',
        meta: { title: '项目管理', icon: 'FolderOpened' },
        children: [
          { id: 21, name: 'ProjectList', path: 'list', component: 'project/list', meta: { title: '项目列表' } },
          { id: 22, name: 'ProjectEdit', path: 'edit', component: 'project/edit', meta: { title: '项目申报录入', hidden: true } },
          { id: 23, name: 'ProjectDetail', path: 'detail', component: 'project/detail', meta: { title: '项目详情查看', hidden: true } }
        ]
      },
      // 2. 专家抽取管理
      {
        id: 3,
        name: 'ExpertExtract',
        path: '/expertExtract',
        redirect: '/expertExtract/extract/list',
        meta: { title: '专家抽取管理', icon: 'UserFilled' },
        children: [
          {
            id: 31,
            name: 'ExtractManage',
            path: '/expertExtract/extract',
            redirect: '/expertExtract/extract/list',
            meta: { title: '抽取管理' },
            children: [{ id: 311, name: 'ExtractList', path: 'list', component: 'extract/list', meta: { title: '列表' } }]
          },
          { id: 32, name: 'ExtractionApplication', path: '/extractionApplication', component: 'extract/list', meta: { title: '抽取申请管理' } },
          {
            id: 33,
            name: 'PreExtractManage',
            path: '/expertExtract/preExtract',
            redirect: '/expertExtract/preExtract/list',
            meta: { title: '专家预抽取管理' },
            children: [{ id: 331, name: 'PreExtractList', path: 'list', component: 'extract/preList', meta: { title: '列表' } }]
          },
          { id: 34, name: 'PreExtractPreview', path: 'preExtract/preview', component: 'extract/prePreview', meta: { title: '预查条件与回避设置', hidden: true } },
          { id: 35, name: 'ExtractDetail', path: 'extract/detail', component: 'extract/detail', meta: { title: '查看', hidden: true } },
          { id: 36, name: 'ExtractExecute', path: 'extract/extract', component: 'extract/extract', meta: { title: '抽取列表', hidden: true } },
          { id: 37, name: 'ExtractApplication', path: 'extract/application', component: 'extract/application', meta: { title: '抽取申请', hidden: true } }
        ]
      },
      // 3. 抽取审批管理
      {
        id: 4,
        name: 'Supervision',
        path: '/supervision',
        redirect: '/supervision/jurySelection',
        meta: { title: '抽取审批管理', icon: 'Checked' },
        children: [
          { id: 41, name: 'JurySelection', path: 'jurySelection', component: 'supervision/jurySelection', meta: { title: '评委抽取审批' } },
          { id: 42, name: 'AuditAndCheck', path: '/auditAndCheck', component: 'supervision/auditAndCheck', meta: { title: '审核查看', hidden: true } }
        ]
      },
      // 4. 专家抽取记录与补抽
      {
        id: 31,
        name: 'ExpertExtractionRecord',
        path: '/expertExtractionRecord',
        redirect: '/expertExtract/supplement/list',
        meta: { title: '专家抽取记录', icon: 'Document' },
        children: [
          { id: 312, name: 'SupplementList', path: '/expertExtract/supplement/list', component: 'extract/supplementList', meta: { title: '项目补抽' } },
          { id: 314, name: 'SupplementDetail', path: '/expertExtract/supplement/detail', component: 'extract/supplementDetail', meta: { title: '项目补抽详情', hidden: true } }
        ]
      },
      // 5. 专家库管理
      {
        id: 50,
        name: 'ExpertDatabaseManagement',
        path: '/expertDatabaseManagement',
        redirect: '/infoManagement/list',
        meta: { title: '专家库管理', icon: 'Management' },
        children: [
          { id: 51, name: 'ChangeApprovalList', path: '/changeApproval/list', component: 'expert/changeList', meta: { title: '专家信息变更审批' } },
          { id: 52, name: 'ExpertInfoList', path: '/infoManagement/list', component: 'expert/list', meta: { title: '专家库信息管理' } },
          { id: 53, name: 'VacateList', path: '/vacate/list', component: 'expert/vacate', meta: { title: '专家请假管理' } },
          { id: 54, name: 'ProfessionalManagement', path: '/professionalManagement', component: 'expert/professionalManagement', meta: { title: '专家专业管理' } },
          { id: 55, name: 'ExpertTitleManagement', path: '/expertTItleManagement', component: 'expert/titleManagement', meta: { title: '专家职称管理' } },
          { id: 56, name: 'ExpertExpertise', path: '/expertExpertise', component: 'expert/expertiseManagement', meta: { title: '专家所学专业管理' } },
          { id: 57, name: 'ExpertEducation', path: '/expertEducation', component: 'expert/educationManagement', meta: { title: '专家学历管理' } },
          { id: 58, name: 'ScoringSituation', path: '/infoManagement/scoringSituation', component: 'expert/scoring', meta: { title: '计分情况', hidden: true } },
          { id: 59, name: 'ExpertViolation', path: '/infoManagement/expertViolation', component: 'expert/violation', meta: { title: '专家违规情况', hidden: true } },
          { id: 60, name: 'ChangeApprovalView', path: '/changeApproval/view', component: 'expert/changeView', meta: { title: '信息变更查看', hidden: true } },
          { id: 63, name: 'InfoManagementView', path: '/infoManagement/view', component: 'expert/infoView', meta: { title: '专家信息查看', hidden: true } },
          { id: 64, name: 'InfoManagementEdit', path: '/infoManagement/edit', component: 'expert/infoEdit', meta: { title: '专家信息编辑', hidden: true } },
          { id: 62, name: 'AuditVacate', path: '/auditVacate', component: 'expert/auditVacate', meta: { title: '请假审核', hidden: true } }
        ]
      },
      // 6. 评价与考核
      {
        id: 70,
        name: 'EvaluationAndAssessment',
        path: '/evaluationAndAssessment',
        redirect: '/evaluate',
        meta: { title: '评价与考核', icon: 'DocumentChecked' },
        children: [
          { id: 71, name: 'EvaluationByJudges', path: '/evaluate', component: 'evaluation/evaluationByJudges', meta: { title: '评委评价' } }
        ]
      },
      // 7. 项目字典管理
      {
        id: 80,
        name: 'ProjectDictionaries',
        path: '/projectDictionaries',
        redirect: '/dictionariesView',
        meta: { title: '项目字典管理', icon: 'Collection' },
        children: [
          { id: 81, name: 'DictionariesView', path: '/dictionariesView', component: 'dict/dictionariesView', meta: { title: '项目字典' } }
        ]
      },
      // 8. 系统工具
      {
        id: 90,
        name: 'SystemTools',
        path: '/systemTools',
        redirect: '/SMSSending',
        meta: { title: '系统工具', icon: 'Tools' },
        children: [
          { id: 91, name: 'SMSSending', path: '/SMSSending', component: 'tool/smsSending', meta: { title: '短信群发' } }
        ]
      }
    )
  }

  res.json(successResponse(menus))
})

export default router
