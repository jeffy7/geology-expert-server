import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { successResponse } from '../types'

const router = Router()
const JWT_SECRET = 'geology-expert-jwt-secret-2026'

// 预设用户底账
const USERS: Record<string, { roleId: string; roleName: string; realName: string }> = {
  lxr: { roleId: 'IdentityRole_33', roleName: '立项人', realName: '李立项' },
  sck: { roleId: 'IdentityRole_34', roleName: '审查科', realName: '王审核' },
  pszx: { roleId: 'IdentityRole_35', roleName: '评审中心', realName: '赵调度' },
  zjgly: { roleId: 'IdentityRole_36', roleName: '专家管理员', realName: '张管理' }
}

// 登录接口 POST /etbApi/etbuser/login
router.post('/login', (req, res) => {
  const { username, identity } = req.body
  const matchedUser = USERS[username] || USERS[identity] || USERS['lxr']

  const token = jwt.sign(
    {
      sub: matchedUser.roleId,
      aud: 'geology-expert-system',
      username,
      role: matchedUser.roleName
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
        username,
        roleId: matchedUser.roleId,
        roleName: matchedUser.roleName,
        realName: matchedUser.realName
      }
    }, '登录成功')
  )
})

// 动态角色菜单列表 GET /etbApi/etbuser/identity/identityRoleMenuList
router.get('/identity/identityRoleMenuList', (req, res) => {
  const identityRole = (req.headers['identityrole'] as string) || 'IdentityRole_33'
  
  // 基础公用菜单
  const baseMenus = [
    {
      id: 1,
      name: '工作台首页',
      path: '/dashboard',
      component: 'dashboard/index',
      meta: { title: '工作台首页', icon: 'Odometer' }
    }
  ]

  // 按角色分发菜单
  if (identityRole === 'IdentityRole_33') { // 立项人
    baseMenus.push(
      {
        id: 2,
        name: '项目管理',
        path: '/projectManage',
        component: 'Layout',
        meta: { title: '项目管理', icon: 'FolderOpened' },
        children: [
          { id: 21, name: '项目台账列表', path: '/projectManage/list', component: 'project/list' }
        ]
      } as any,
      {
        id: 3,
        name: '专家抽取管理',
        path: '/expertExtract',
        component: 'Layout',
        meta: { title: '专家抽取管理', icon: 'UserFilled' },
        children: [
          { id: 31, name: '抽取管理列表', path: '/expertExtract/extract/list', component: 'extract/list' },
          { id: 32, name: '预查条件与回避设置', path: '/expertExtract/preExtract/preview', component: 'extract/prePreview' }
        ]
      } as any
    )
  } else if (identityRole === 'IdentityRole_34') { // 审查科
    baseMenus.push(
      {
        id: 4,
        name: '监督审批管理',
        path: '/supervision',
        component: 'Layout',
        meta: { title: '监督审批管理', icon: 'Checked' },
        children: [
          { id: 41, name: '评委抽取审批工作台', path: '/supervision/jurySelection', component: 'supervision/jurySelection' }
        ]
      } as any
    )
  } else if (identityRole === 'IdentityRole_35') { // 评审中心
    baseMenus.push(
      {
        id: 3,
        name: '专家抽取管理',
        path: '/expertExtract',
        component: 'Layout',
        meta: { title: '专家抽取管理', icon: 'UserFilled' },
        children: [
          { id: 31, name: '抽取管理列表', path: '/expertExtract/extract/list', component: 'extract/list' },
          { id: 33, name: '智能抽取与外呼详情', path: '/expertExtract/extract/detail', component: 'extract/detail' },
          { id: 34, name: '项目补抽管理', path: '/expertExtract/supplement/detail', component: 'extract/supplementDetail' }
        ]
      } as any
    )
  } else if (identityRole === 'IdentityRole_36') { // 专家管理员
    baseMenus.push(
      {
        id: 5,
        name: '专家库全息管理',
        path: '/expertManage',
        component: 'Layout',
        meta: { title: '专家库全息管理', icon: 'Management' },
        children: [
          { id: 51, name: '专家库信息台账', path: '/expertManage/infoManagement/list', component: 'expert/list' },
          { id: 52, name: '计分与违规闭环', path: '/expertManage/scoringSituation', component: 'expert/scoring' },
          { id: 53, name: '专家请假审批', path: '/expertManage/vacate/list', component: 'expert/vacate' }
        ]
      } as any
    )
  }

  res.json(successResponse(baseMenus))
})

export default router

