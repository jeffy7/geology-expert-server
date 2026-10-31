import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { successResponse, errorResponse } from '../types'
import { JWT_SECRET, authenticateToken } from '../middleware/auth'

const router = Router()

// 系统四大核心角色预置档案
export const SYSTEM_ROLES: Record<string, { roleId: string; roleName: string; realName: string; department: string }> = {
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

// 1. 用户登录 POST /etbApi/etbuser/login
router.post('/login', (req, res) => {
  const { username, identity } = req.body
  const roleKey = username || identity || 'lxr'
  const matchedUser = SYSTEM_ROLES[roleKey] || SYSTEM_ROLES['lxr']

  const token = generateUserToken(roleKey)

  res.json(
    successResponse({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 604800,
      user_info: {
        username: roleKey,
        roleId: matchedUser.roleId,
        roleName: matchedUser.roleName,
        realName: matchedUser.realName,
        department: matchedUser.department
      }
    }, '登录成功')
  )
})

// 2. 获取当前登录用户信息 GET /etbApi/etbuser/info
router.get('/info', authenticateToken, (req, res) => {
  if (!req.user) {
    res.status(401).json(errorResponse('身份未验证', 401))
    return
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
router.get('/identity/identityRoleMenuList', (req, res) => {
  const identityRole = (req.headers['identityrole'] as string) || 'IdentityRole_33'

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
            name: 'ExtractList',
            path: 'extract/list',
            component: 'extract/list',
            meta: { title: '抽取管理列表' }
          },
          {
            id: 32,
            name: 'PreExtractPreview',
            path: 'preExtract/preview',
            component: 'extract/prePreview',
            meta: { title: '预查条件与回避设置' }
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
        meta: { title: '监督审批管理', icon: 'Checked' },
        children: [
          {
            id: 41,
            name: 'JurySelection',
            path: 'jurySelection',
            component: 'supervision/jurySelection',
            meta: { title: '评委抽取审批工作台' }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_35') {
    // 评审中心 (pszx)
    menus.push(
      {
        id: 3,
        name: 'ExpertExtract',
        path: '/expertExtract',
        redirect: '/expertExtract/extract/list',
        meta: { title: '专家抽取管理', icon: 'UserFilled' },
        children: [
          {
            id: 31,
            name: 'ExtractList',
            path: 'extract/list',
            component: 'extract/list',
            meta: { title: '抽取管理列表' }
          },
          {
            id: 33,
            name: 'ExtractDetail',
            path: 'extract/detail',
            component: 'extract/detail',
            meta: { title: '智能抽取与外呼详情' }
          },
          {
            id: 34,
            name: 'SupplementDetail',
            path: 'supplement/detail',
            component: 'extract/supplementDetail',
            meta: { title: '项目补抽管理' }
          }
        ]
      }
    )
  } else if (identityRole === 'IdentityRole_36') {
    // 专家管理员 (zjgly)
    menus.push(
      {
        id: 5,
        name: 'ExpertManage',
        path: '/expertManage',
        redirect: '/expertManage/infoManagement/list',
        meta: { title: '专家库全息管理', icon: 'Management' },
        children: [
          {
            id: 51,
            name: 'ExpertInfoList',
            path: 'infoManagement/list',
            component: 'expert/list',
            meta: { title: '专家库信息台账' }
          },
          {
            id: 52,
            name: 'ScoringSituation',
            path: 'scoringSituation',
            component: 'expert/scoring',
            meta: { title: '计分与违规闭环' }
          },
          {
            id: 53,
            name: 'VacateList',
            path: 'vacate/list',
            component: 'expert/vacate',
            meta: { title: '专家请假审批' }
          }
        ]
      }
    )
  }

  res.json(successResponse(menus))
})

export default router
