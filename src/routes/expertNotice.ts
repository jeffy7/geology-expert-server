import { Router } from 'express'
import { pool } from '../config/db'
import { successResponse, errorResponse } from '../types'
import { sendTtsVoice, sendCodeVoice, getVmsConfigSummary, printVmsProperties, vmsConfig } from '../services/vms'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

const router = Router()

// 1. 获取语音外呼服务状态与脱敏配置 GET /etbApi/expert-notice/config
router.get('/config', (_req, res) => {
  res.json(successResponse(getVmsConfigSummary(), '外呼服务配置查询成功'))
})

// 2. 打印原生 VmsProperties GET /etbApi/expert-notice/print-vms-properties
router.get('/print-vms-properties', (_req, res) => {
  res.json(successResponse(printVmsProperties()))
})

// 3. 启动专家抽取外呼通知 GET /etbApi/expert-notice/start
router.get('/start', async (req, res) => {
  try {
    const { projectId, ruleId, groupId } = req.query
    if (!projectId || !ruleId) {
      return res.status(400).json(errorResponse('缺少必须的项目ID或规则ID'))
    }

    // 1. 查询项目信息构建通知文案模板
    const [pRows] = await pool.query<RowDataPacket[]>(
      `SELECT project_name, project_no, bid_open_time, evaluation_room, link_phone, review_category
       FROM project WHERE id = ?`,
      [projectId]
    )
    const project = pRows[0] || {
      project_name: '地调院矿产专家评审项目',
      project_no: 'PROJECT-2026',
      bid_open_time: new Date().toISOString(),
      evaluation_room: '主评审室',
      link_phone: '0471-12345678'
    }

    // 2. 查询需要通知的专家名单
    let querySql = `
      SELECT r.id, r.project_id, r.rule_id, r.ei_id, r.ei_name, r.ei_phone, IF(r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', 1, 2) as leader, r.notice_state
      FROM extract_rule_result r
      WHERE r.project_id = ? AND r.rule_id = ?
    `
    const qParams: any[] = [projectId, ruleId]
    if (groupId) {
      querySql += ` AND r.group_id = ?`
      qParams.push(groupId)
    }

    const [ruleResults] = await pool.query<RowDataPacket[]>(querySql, qParams)
    if (!ruleResults || ruleResults.length === 0) {
      return res.json(successResponse(null, '未找到待通知的专家记录'))
    }

    // 3. 循环发起外呼并记录流水
    const noticeDetails: any[] = []
    for (const r of ruleResults) {
      if (!r.ei_phone) continue

      const templateParams = [
        project.project_name || '地质矿产专家抽取评审',
        r.leader === 1 ? '组长' : '组员',
        project.evaluation_room || '专家评审会议室'
      ]

      const callResult = await sendTtsVoice(r.ei_phone, templateParams)
      const callId = callResult.callId || `call-${Date.now()}-${r.id}`

      // 插入/更新 notice_expert_callback 表
      const callbackId = Date.now() + Math.floor(Math.random() * 1000)
      await pool.query(
        `INSERT INTO notice_expert_callback
         (id, extrace_rule_result_id, call_id, retry_num, remark, insert_time)
         VALUES (?, ?, ?, 0, ?, NOW())`,
        [
          callbackId,
          r.id,
          callId,
          `已发起首次语音通知 (${vmsConfig.channel === 'voicebox' ? '语音盒子' : '腾讯云VMS'})`
        ]
      ).catch(e => console.warn('[expert-notice] 记录通知流水异常:', e.message))

      // 更新 extract_rule_result 表的通知状态 notice_state = 1
      await pool.query(
        `UPDATE extract_rule_result SET notice_state = 1 WHERE id = ?`,
        [r.id]
      )

      noticeDetails.push({
        extractRuleResultId: r.id,
        eiName: r.ei_name,
        phone: r.ei_phone,
        callId,
        success: callResult.success
      })
    }

    res.json(successResponse({ count: noticeDetails.length, details: noticeDetails }, '专家外呼通知已批量下发'))
  } catch (error: any) {
    console.error('[expert-notice] 启动通知失败:', error)
    res.status(500).json(errorResponse(error.message || '启动通知失败'))
  }
})

// 4. 继续通知未确认专家 GET /etbApi/expert-notice/continue
router.get('/continue', async (req, res) => {
  try {
    const { projectId, ruleId, groupId } = req.query
    if (!projectId || !ruleId) {
      return res.status(400).json(errorResponse('缺少必须的项目ID或规则ID'))
    }

    // 查询仍未确认(participate_state IS NULL OR participate_state = 0)的抽取结果
    let querySql = `
      SELECT r.id, r.ei_id, r.ei_name, r.ei_phone, IF(r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', 1, 2) as leader, c.id as callback_id, c.retry_num
      FROM extract_rule_result r
      LEFT JOIN notice_expert_callback c ON r.id = c.extrace_rule_result_id
      WHERE r.project_id = ? AND r.rule_id = ? AND (r.participate_state IS NULL OR r.participate_state = 0)
    `
    const qParams: any[] = [projectId, ruleId]
    if (groupId) {
      querySql += ` AND r.group_id = ?`
      qParams.push(groupId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(querySql, qParams)
    const continuedList: any[] = []

    for (const r of rows) {
      if (!r.ei_phone) continue
      const currentRetry = Number(r.retry_num || 0) + 1
      if (currentRetry > vmsConfig.retryNum) {
        continue // 超过最大重试次数
      }

      const callResult = await sendTtsVoice(r.ei_phone, ['地调院专家评审补呼通知'])
      const callId = callResult.callId || `continue-${Date.now()}-${r.id}`

      if (r.callback_id) {
        await pool.query(
          `UPDATE notice_expert_callback
           SET call_id = ?, retry_num = ?, remark = ?, last_update_time = NOW()
           WHERE id = ?`,
          [callId, currentRetry, `第${currentRetry}次重试呼叫`, r.callback_id]
        )
      } else {
        const callbackId = Date.now() + Math.floor(Math.random() * 1000)
        await pool.query(
          `INSERT INTO notice_expert_callback
           (id, extrace_rule_result_id, call_id, retry_num, remark, insert_time)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [callbackId, r.id, callId, currentRetry, `第${currentRetry}次重试呼叫`]
        )
      }

      continuedList.push({
        id: r.id,
        eiName: r.ei_name,
        retryNum: currentRetry,
        callId
      })
    }

    res.json(successResponse({ count: continuedList.length, details: continuedList }, '继续外呼通知执行完毕'))
  } catch (error: any) {
    console.error('[expert-notice] 继续通知失败:', error)
    res.status(500).json(errorResponse(error.message || '继续通知失败'))
  }
})

// 5. 手动触发回调通知 GET /etbApi/expert-notice/sendCallBack
router.get('/sendCallBack', async (req, res) => {
  try {
    const { projectId, ruleId, groupId } = req.query
    res.json(successResponse({ projectId, ruleId, groupId }, '回调测试指令已下发'))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// 6. 专家外呼流水详情 GET /etbApi/expert-notice/detail
router.get('/detail', async (req, res) => {
  try {
    const {
      extractRuleResultId,
      extraceRuleResultId,
      current = '1',
      size = '10'
    } = req.query

    const targetId = extractRuleResultId || extraceRuleResultId
    const p = Math.max(1, parseInt(current as string, 10))
    const ps = Math.max(1, parseInt(size as string, 10))
    const offset = (p - 1) * ps

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (targetId) {
      whereClause += ' AND c.extrace_rule_result_id = ?'
      params.push(targetId)
    }

    const [cntRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM notice_expert_callback c ${whereClause}`,
      params
    )
    const total = cntRows[0]?.total || 0

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, r.ei_name, r.ei_phone, r.participate_state
       FROM notice_expert_callback c
       LEFT JOIN extract_rule_result r ON c.extrace_rule_result_id = r.id
       ${whereClause}
       ORDER BY c.insert_time DESC
       LIMIT ? OFFSET ?`,
      [...params, ps, offset]
    )

    const list = rows.map((r: any) => {
      let keypress = null
      if (r.voicekey_callback) {
        try {
          const parsed = typeof r.voicekey_callback === 'string' ? JSON.parse(r.voicekey_callback) : r.voicekey_callback
          keypress = parsed.keypress || parsed.keyPress
        } catch (_) {}
      }
      return {
        id: r.id,
        extraceRuleResultId: r.extrace_rule_result_id,
        callId: r.call_id,
        retryNum: r.retry_num || 0,
        remark: r.remark,
        keypress: keypress || (r.participate_state === 1 ? '1' : r.participate_state === 0 ? '2' : null),
        callStatus: r.participate_state === 1 ? '已确认' : r.participate_state === 0 ? '已拒绝' : '通知中',
        insertTime: r.insert_time,
        lastUpdateTime: r.last_update_time
      }
    })

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
    console.error('[expert-notice] 查询通知明细失败:', error)
    res.status(500).json(errorResponse(error.message || '查询通知明细失败'))
  }
})

// 7. 外呼时间轴流水 GET /etbApi/expert-notice/time-line
router.get('/time-line', async (req, res) => {
  try {
    const { callId } = req.query
    if (!callId) {
      return res.status(400).json(errorResponse('必须提供 callId'))
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, r.ei_name, r.ei_phone, r.participate_state
       FROM notice_expert_callback c
       LEFT JOIN extract_rule_result r ON c.extrace_rule_result_id = r.id
       WHERE c.call_id = ?`,
      [callId]
    )
    const item = rows[0]

    const timeline = [
      { timestamp: item?.insert_time || new Date(), event: '外呼请求已生成并提交语音通道', status: 'INIT' },
      { timestamp: item?.insert_time || new Date(), event: '专家电话振铃中', status: 'RINGING' },
      { timestamp: item?.last_update_time || new Date(), event: '专家接听通话，语音播报中', status: 'ANSWERED' },
      {
        timestamp: item?.last_update_time || new Date(),
        event: item?.participate_state === 1 ? '专家按 1 确认参加评审' : '专家按 2 或未在规定时间内按键确认',
        status: item?.participate_state === 1 ? 'CONFIRMED' : 'REJECTED'
      }
    ]

    res.json(successResponse({ callId, timeline, expert: item?.ei_name }))
  } catch (error: any) {
    res.status(500).json(errorResponse(error.message))
  }
})

// 8. 原生测试短信接口 GET /etbApi/expert-notice/test-send-sms
router.get('/test-send-sms', (_req, res) => {
  res.json(successResponse({ status: 'ok', msg: '测试短信通道正常' }))
})

// 9. 原生测试外呼接口 GET /etbApi/expert-notice/send-test-message
router.get('/send-test-message', async (_req, res) => {
  const result = await sendTtsVoice('13800000000', ['测试项目', '专家评审测试'])
  res.json(successResponse(result))
})

// 10. 发起单通测试外呼 POST /etbApi/expert-notice/test-call
router.post('/test-call', async (req, res) => {
  try {
    const { phone, type = 'tts', code = '8888', params } = req.body
    if (!phone) {
      return res.status(400).json(errorResponse('必须提供测试手机号 phone'))
    }

    let result
    if (type === 'code') {
      result = await sendCodeVoice(phone, String(code))
    } else {
      result = await sendTtsVoice(phone, params || ['地调院专家评审测试', '准时参加'])
    }

    if (result.success) {
      res.json(successResponse(result, result.message))
    } else {
      res.status(502).json(errorResponse(result.message, 502))
    }
  } catch (error: any) {
    console.error('[expert-notice] 测试外呼异常:', error)
    res.status(500).json(errorResponse(error.message || '测试呼叫异常'))
  }
})

// 11. 语音设备/腾讯云 VMS 结果回调接口 POST /etbApi/expert-notice/callback
router.post('/callback', async (req, res) => {
  try {
    const payload = req.body || {}
    console.log('[expert-notice] 收到语音外呼回调通知:', JSON.stringify(payload))

    // 兼容多种回调字段格式（语音盒子与腾讯云）
    const callId = payload.callId || payload.callid || payload.voiceId
    const mobile = payload.mobile || payload.calledNumber || payload.phone
    const keypress = payload.keypress || payload.keyPress || payload.digit || (payload.voicekeyCallback && payload.voicekeyCallback.keypress)
    const failureCode = payload.failure_code || payload.failureCode

    if (callId) {
      const isAgree = String(keypress) === String(vmsConfig.agreeKey)
      const isReject = String(keypress) === String(vmsConfig.rejectKey)

      // 1. 查找是否存在对应的回调流水
      const [cbRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, extrace_rule_result_id FROM notice_expert_callback WHERE call_id = ?`,
        [callId]
      )

      let resultId = cbRows[0]?.extrace_rule_result_id

      if (!resultId && mobile) {
        // 通过手机号查找最近一次抽取结果
        const [rRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, ei_id FROM extract_rule_result WHERE ei_phone = ? ORDER BY id DESC LIMIT 1`,
          [mobile.replace(/^\+86/, '')]
        )
        resultId = rRows[0]?.id
      }

      // 2. 记录到流水表
      if (cbRows[0]?.id) {
        await pool.query(
          `UPDATE notice_expert_callback
           SET voicekey_callback = ?, remark = ?, last_update_time = NOW()
           WHERE id = ?`,
          [
            JSON.stringify(payload),
            isAgree ? '专家按键【1】确认同意参会' : isReject ? '专家按键【2】拒绝参会' : '专家按键超时或通话异常',
            cbRows[0].id
          ]
        )
      } else {
        await pool.query(
          `INSERT INTO notice_expert_callback
           (id, extrace_rule_result_id, call_id, retry_num, remark, voicekey_callback, insert_time)
           VALUES (?, ?, ?, 0, ?, ?, NOW())`,
          [
            Date.now(),
            resultId || null,
            callId,
            isAgree ? '专家按键【1】确认同意参会' : isReject ? '专家按键【2】拒绝参会' : '专家按键超时',
            JSON.stringify(payload)
          ]
        ).catch(() => {})
      }

      // 3. 联动更新 extract_rule_result 与 expert_info_base 专家锁定状态
      if (resultId) {
        const [rData] = await pool.query<RowDataPacket[]>(
          `SELECT id, ei_id, project_id FROM extract_rule_result WHERE id = ?`,
          [resultId]
        )
        const eiId = rData[0]?.ei_id

        if (isAgree) {
          // 确认参加：participate_state = 1，锁定专家
          await pool.query(
            `UPDATE extract_rule_result
             SET participate_state = 1, notice_state = 2, confirm_date = NOW()
             WHERE id = ?`,
            [resultId]
          )
          if (eiId) {
            await pool.query(
              `UPDATE expert_info_base SET if_lock = 1 WHERE id = ?`,
              [eiId]
            ).catch(() => {})
          }
          console.log(`[expert-notice] 专家 (ID: ${eiId}) 同意参会，已更新状态并锁定账号`)
        } else if (isReject) {
          // 拒绝参加：participate_state = 0，释放锁定便于后续补抽
          await pool.query(
            `UPDATE extract_rule_result
             SET participate_state = 0, notice_state = 2
             WHERE id = ?`,
            [resultId]
          )
          if (eiId) {
            await pool.query(
              `UPDATE expert_info_base SET if_lock = 0 WHERE id = ?`,
              [eiId]
            ).catch(() => {})
          }
          console.log(`[expert-notice] 专家 (ID: ${eiId}) 拒绝参会，已解除锁定以备补抽`)
        }
      }

      // 4. 若为腾讯云严重错误码，停用账号
      if (failureCode && vmsConfig.ignoreRetryFailCodeList.includes(Number(failureCode)) && mobile) {
        await pool.query(
          `UPDATE expert_info_base SET status = 1 WHERE phone = ?`,
          [mobile.replace(/^\+86/, '')]
        ).catch(() => {})
      }
    }

    res.json({ result: 0, errmsg: 'OK' })
  } catch (error: any) {
    console.error('[expert-notice] 回调处理异常:', error)
    res.status(500).json({ result: -1, errmsg: error.message })
  }
})

export default router
