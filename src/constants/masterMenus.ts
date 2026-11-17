export interface ServerMenuItem {
  id: number
  name: string
  path: string
  component?: string
  redirect?: string
  meta: {
    title: string
    icon?: string
    hidden?: boolean
  }
  children?: ServerMenuItem[]
}

export const MASTER_MENU_TREE: ServerMenuItem[] = [
  // 0. 工作台首页
  {
    id: 1,
    name: 'Dashboard',
    path: '/dashboard',
    component: 'dashboard/index',
    meta: { title: '工作台首页', icon: 'Odometer' }
  },
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
        children: [{ id: 311, name: 'ExtractList', path: 'list', component: 'extract/list', meta: { title: '抽取列表' } }]
      },
      { id: 32, name: 'ExtractionApplication', path: '/extractionApplication', component: 'extract/list', meta: { title: '抽取申请管理' } },
      {
        id: 33,
        name: 'PreExtractManage',
        path: '/expertExtract/preExtract',
        redirect: '/expertExtract/preExtract/list',
        meta: { title: '专家预抽取管理' },
        children: [{ id: 331, name: 'PreExtractList', path: 'list', component: 'extract/preList', meta: { title: '预抽取列表' } }]
      },
      { id: 34, name: 'PreExtractPreview', path: 'preExtract/preview', component: 'extract/prePreview', meta: { title: '预查条件与回避设置', hidden: true } },
      { id: 35, name: 'ExtractDetail', path: 'extract/detail', component: 'extract/detail', meta: { title: '抽取详情查看', hidden: true } },
      { id: 36, name: 'ExtractExecute', path: 'extract/extract', component: 'extract/extract', meta: { title: '执行抽取', hidden: true } },
      { id: 37, name: 'ExtractApplication', path: 'extract/application', component: 'extract/application', meta: { title: '抽取申请录入', hidden: true } }
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
    id: 38,
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
  },
  // 9. 系统管理（用户与角色权限）
  {
    id: 100,
    name: 'SystemManage',
    path: '/system',
    redirect: '/system/user',
    meta: { title: '系统管理', icon: 'Setting' },
    children: [
      { id: 101, name: 'UserManage', path: 'user', component: 'system/user', meta: { title: '用户管理' } },
      { id: 102, name: 'RoleManage', path: 'role', component: 'system/role', meta: { title: '角色权限管理' } }
    ]
  }
]

// 仅获取用于在前端角色权限树中勾选的可见菜单（剔除 hidden: true 的详情/录入等内页）
export function getVisibleMenuTree(tree: ServerMenuItem[] = MASTER_MENU_TREE): ServerMenuItem[] {
  const result: ServerMenuItem[] = []

  for (const item of tree) {
    if (item.meta?.hidden) {
      continue
    }

    if (item.children && item.children.length > 0) {
      const visibleChildren = getVisibleMenuTree(item.children)
      result.push({
        ...item,
        children: visibleChildren
      })
    } else {
      result.push({ ...item })
    }
  }

  return result
}

// 递归获取所有可见菜单项的全部 ID
export function getVisibleMenuIds(tree: ServerMenuItem[] = MASTER_MENU_TREE): number[] {
  const ids: number[] = []
  const traverse = (nodes: ServerMenuItem[]) => {
    for (const node of nodes) {
      if (node.meta?.hidden) continue
      ids.push(node.id)
      if (node.children && node.children.length > 0) {
        traverse(node.children)
      }
    }
  }
  traverse(tree)
  return ids
}

// 递归根据允许的 MenuId 集合过滤完整路由树
// 规则：只要主菜单被授权，其所属的详情、录入等内部子页面 (hidden: true) 自动继承授权，避免单独配置
export function filterMenuTree(tree: ServerMenuItem[], allowedIds: Set<number>, parentAllowed = false): ServerMenuItem[] {
  const result: ServerMenuItem[] = []

  for (const item of tree) {
    const isCurrentAllowed = allowedIds.has(item.id)

    if (item.children && item.children.length > 0) {
      // 检查当前子级中是否有被显式允许的可见节点
      const hasAllowedChild = item.children.some((c) => allowedIds.has(c.id))
      const shouldAllowChildren = isCurrentAllowed || parentAllowed || hasAllowedChild

      const filteredChildren = filterMenuTree(item.children, allowedIds, shouldAllowChildren)
      if (isCurrentAllowed || filteredChildren.length > 0) {
        result.push({
          ...item,
          children: filteredChildren
        })
      }
    } else {
      // 叶子节点：若是显式允许的菜单，或者父级模块已被授权的内部详情页 (hidden: true)，则自动放行
      const isHiddenChild = Boolean(item.meta?.hidden) && parentAllowed
      if (isCurrentAllowed || isHiddenChild) {
        result.push({ ...item })
      }
    }
  }

  return result
}
