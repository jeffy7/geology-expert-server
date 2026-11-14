import { pool } from '../config/db'
import { voiceBoxService } from './voiceBox'
import type { RowDataPacket } from 'mysql2'

export interface QueueItem {
  id: number
  projectId: string
  ruleId: string
  groupId: string // '1' = 组长, '2' = 组员
  eiId: number
  eiName: string
  phone: string
  retryNum: number
}

class NoticeQueueService {
  private queue: QueueItem[] = []
  private isProcessing = false
  private currentRunningProject: { projectId: string, ruleId: string, groupId: string } | null = null
  private currentDialing: QueueItem | null = null

  public getStatus() {
    return {
      isProcessing: this.isProcessing,
      queueLength: this.queue.length,
      currentRunningProject: this.currentRunningProject,
      currentDialing: this.currentDialing ? {
        id: this.currentDialing.id,
        name: this.currentDialing.eiName,
        phone: this.currentDialing.phone,
        retryNum: this.currentDialing.retryNum
      } : null
    }
  }

  /**
   * 启动某项目特定分组的排队外呼 (一键点击后全自动顺呼)
   */
  public async startQueue(projectId: string | number, ruleId: string | number, groupId: string = '1') {
    const pId = String(projectId)
    const rId = String(ruleId)

    // 1. 查询该分组下所有未明确答复同意的专家 (必须使用字符串比对 Snowflake ID 规避精度截断)
    let querySql = `
      SELECT r.id, r.project_id, r.rule_id, r.ei_id, r.ei_name, COALESCE(b.phone, r.ei_phone) as ei_phone, 
             IF(r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%', '1', '2') as groupId,
             r.notice_state, r.participate_state,
             COALESCE(c.retry_num, 0) as retry_num
      FROM extract_rule_result r
      LEFT JOIN expert_info_base b ON r.ei_id = b.id
      LEFT JOIN (
        SELECT extrace_rule_result_id, MAX(retry_num) as retry_num
        FROM notice_expert_callback GROUP BY extrace_rule_result_id
      ) c ON r.id = c.extrace_rule_result_id
      WHERE (r.project_id = ? OR r.rule_id = ?) 
        AND (r.participate_state IS NULL OR r.participate_state = 0)
        AND (r.avoidance_flag IS NULL OR r.avoidance_flag = 0)
    `
    if (groupId === '1' || groupId.includes('leader')) {
      querySql += ` AND (r.condition_key LIKE '%leader%' OR r.condition_key LIKE '%Leader%')`
    } else {
      querySql += ` AND (r.condition_key NOT LIKE '%leader%' AND r.condition_key NOT LIKE '%Leader%')`
    }
    querySql += ` ORDER BY r.id ASC`

    const [rows] = await pool.query<RowDataPacket[]>(querySql, [pId, rId])
    if (!rows || rows.length === 0) {
      return { success: false, message: '未找到待外呼的候选专家记录（或已全员确认参会）' }
    }

    let addedCount = 0
    for (const r of rows) {
      if (!r.ei_phone) continue
      // 同步更新抽取表最新手机号
      await pool.query('UPDATE extract_rule_result SET ei_phone = ? WHERE id = ?', [r.ei_phone, r.id]).catch(() => {})

      // 避免重复入队
      if (!this.queue.some(q => q.id === r.id)) {
        this.queue.push({
          id: r.id,
          projectId: pId,
          ruleId: rId,
          groupId: String(groupId),
          eiId: r.ei_id,
          eiName: r.ei_name,
          phone: r.ei_phone,
          retryNum: Number(r.retry_num || 0)
        })
        addedCount++
      }
    }

    this.currentRunningProject = { projectId: pId, ruleId: rId, groupId: String(groupId) }

    // 触发异步排队调度执行，不阻塞当前请求
    if (!this.isProcessing) {
      this.processNext()
    }

    return {
      success: true,
      message: `已将 ${addedCount} 位专家加入外呼排队队列，系统正在依次自动拨号（每位呼叫完毕间隔 5 秒顺呼）...`,
      queueLength: this.queue.length
    }
  }

  /**
   * 顺序处理队列中的下一位专家 (排队顺呼机制)
   */
  private async processNext() {
    if (this.queue.length === 0) {
      console.log(`[NoticeQueue] 🎉 本批外呼队列已全部执行完毕！准备核查本组完成度...`)
      this.isProcessing = false
      this.currentDialing = null
      if (this.currentRunningProject) {
        const { projectId, ruleId, groupId } = this.currentRunningProject
        await this.checkGroupCompletion(projectId, ruleId, groupId)
        this.currentRunningProject = null
      }
      return
    }

    this.isProcessing = true
    const item = this.queue.shift()!
    this.currentDialing = item

    try {
      console.log(`[NoticeQueue] ➡️ [第 ${item.retryNum + 1} 次外呼] 开始呼叫专家: ${item.eiName} (${item.phone}) ...`)

      // 1. 更新数据库状态为通知中 (notice_state = 1)
      await pool.query('UPDATE extract_rule_result SET notice_state = 1 WHERE id = ?', [item.id])
      const ruleState = item.groupId === '1' ? 21 : 211
      await pool.query('UPDATE extract_rule SET extracting_state = ? WHERE id = ?', [ruleState, item.ruleId]).catch(() => {})

      // 2. 发起硬件语音盒子拨号
      const dialRes = await voiceBoxService.dial(item.phone, { extractRuleResultId: item.id })
      const callId = dialRes.callId || `vb-${Date.now()}-${item.id}`

      // 记录本次外呼流水
      const callbackId = Date.now() + Math.floor(Math.random() * 1000)
      await pool.query(
        `INSERT INTO notice_expert_callback (id, extrace_rule_result_id, call_id, retry_num, remark, insert_time)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [callbackId, item.id, callId, item.retryNum, `第${item.retryNum + 1}次发起语音外呼，等待接听与按键确认...`]
      ).catch(() => {})

      // 3. 阻塞等待通话结果 (最长 50 秒安全超时)
      const callResult = await voiceBoxService.waitForCallResolution(50000)
      console.log(`[NoticeQueue] 📞 专家 ${item.eiName} 通话结束，最终判定:`, callResult)

      // 4. 根据结果处理重试与状态流转
      if (callResult.status === 'agreed') {
        // 同意参会：已由 handleKeypressCallback 自动更新 participate_state = 1
        console.log(`[NoticeQueue] ✅ 专家 ${item.eiName} 确认同意参会！`)
      } else if (callResult.status === 'rejected') {
        // 明确放弃参会：已由 handleKeypressCallback 自动更新 participate_state = 0
        console.log(`[NoticeQueue] ❌ 专家 ${item.eiName} 明确放弃参会！`)
      } else {
        // 未按键 / 没打通 / 超时未接 / 直接挂断
        const nextRetry = item.retryNum + 1
        if (nextRetry < 3) {
          // 未满 3 次：放回队列末尾进行轮询重试
          console.log(`[NoticeQueue] ⚠️ 专家 ${item.eiName} 本次未按键/未接通，放回队尾等待第 ${nextRetry + 1} 次轮询重试...`)
          await pool.query(
            `UPDATE notice_expert_callback SET retry_num = ?, remark = ?, last_update_time = NOW() WHERE call_id = ?`,
            [nextRetry, `第${nextRetry}次呼叫无应答/未按键，等待轮询重试`, callId]
          ).catch(() => {})
          item.retryNum = nextRetry
          this.queue.push(item)
        } else {
          // 满 3 次：对齐原系统规则，强制判定“三次未响应，视为不参与”
          console.log(`[NoticeQueue] 🛑 专家 ${item.eiName} 已达 3 次未响应，自动判定为不参与！`)
          await pool.query(
            `UPDATE extract_rule_result SET participate_state = 0, notice_state = 2, confirm_date = NOW() WHERE id = ?`,
            [item.id]
          )
          await pool.query(
            `UPDATE notice_expert_callback SET retry_num = 3, remark = '三次未响应，视为不参与', last_update_time = NOW() WHERE call_id = ?`,
            [callId]
          ).catch(() => {})
        }
      }
    } catch (err: any) {
      console.error(`[NoticeQueue] 呼叫调度执行异常:`, err.message)
    } finally {
      this.currentDialing = null
    }

    // 5. 严格对齐原系统：完成一位后延时 5 秒 (5000ms)，释放信道并进入下一位呼叫！
    console.log(`[NoticeQueue] ⏳ 本位呼叫结束，等待 5 秒后呼叫下一位专家...`)
    setTimeout(() => {
      this.processNext()
    }, 5000)
  }

  /**
   * 核查该组是否满足目标人数，驱动状态流转或补抽
   */
  public async checkGroupCompletion(projectId: string | number, ruleId: string | number, groupId: string) {
    try {
      const pId = String(projectId)
      const rId = String(ruleId)
      console.log(`[NoticeQueue] 🔍 正在执行组完成度核查: projectId=${pId}, ruleId=${rId}, groupId=${groupId}`)

      // 1. 读取规则快照中的目标人数
      let leaderNum = 1
      let memberNum = 4
      const [snaps] = await pool.query<RowDataPacket[]>(
        `SELECT rule_snapshot FROM extract_rule_snapshot WHERE rule_id = ? ORDER BY id DESC LIMIT 1`,
        [rId]
      )
      if (snaps[0]?.rule_snapshot) {
        try {
          const parsed = typeof snaps[0].rule_snapshot === 'string' ? JSON.parse(snaps[0].rule_snapshot) : snaps[0].rule_snapshot
          if (parsed.leaderNum) leaderNum = Number(parsed.leaderNum)
          if (parsed.memberNum) memberNum = Number(parsed.memberNum)
          else if (parsed.totalExpertNum) memberNum = Number(parsed.totalExpertNum) - leaderNum
        } catch (_) {}
      }

      // 2. 查询当前已确认人数 (participate_state = 1)
      const [leaderRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM extract_rule_result 
         WHERE (project_id = ? OR rule_id = ?) AND (condition_key LIKE '%leader%' OR condition_key LIKE '%Leader%') AND participate_state = 1`,
        [pId, rId]
      )
      const confirmedLeader = Number(leaderRows[0]?.cnt || 0)

      const [memberRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM extract_rule_result 
         WHERE (project_id = ? OR rule_id = ?) AND (condition_key NOT LIKE '%leader%' AND condition_key NOT LIKE '%Leader%') AND participate_state = 1`,
        [pId, rId]
      )
      const confirmedMember = Number(memberRows[0]?.cnt || 0)

      console.log(`[NoticeQueue] 📊 核查统计: 组长目标=${leaderNum}, 已同意=${confirmedLeader} | 组员目标=${memberNum}, 已同意=${confirmedMember}`)

      if (groupId === '1') {
        if (confirmedLeader >= leaderNum) {
          console.log(`[NoticeQueue] ✅ 评审组长已确认同意参会！状态流转为 23 (LEADER_EXTRACTING_NOTICE_DONE_AND_SATISFIED)`)
          await pool.query(`UPDATE extract_rule SET extracting_state = 23 WHERE id = ?`, [rId])
        } else {
          console.warn(`[NoticeQueue] ⚠️ 评审组长通知完毕但不满足！状态流转为 24 (LEADER_EXTRACTING_NOTICE_DONE_BUT_NOT_SATISFIED)`)
          await pool.query(`UPDATE extract_rule SET extracting_state = 24 WHERE id = ?`, [rId])
        }
      } else {
        if (confirmedMember >= memberNum) {
          console.log(`[NoticeQueue] ✅ 评审组员已全额同意参会！状态流转为 231 (CREW_EXTRACTING_NOTICE_DONE_AND_SATISFIED)`)
          await pool.query(`UPDATE extract_rule SET extracting_state = 231 WHERE id = ?`, [rId])
          if (confirmedLeader >= leaderNum) {
            // 全员满足，项目完成抽取
            console.log(`[NoticeQueue] 🏆 全项目专家确认完毕，抽取圆满成功！extract_state = 2`)
            await pool.query(`UPDATE extract_rule SET extract_state = 2 WHERE id = ?`, [rId])
            await pool.query(`UPDATE project SET extract_state = 2 WHERE id = ?`, [pId])
          }
        } else {
          console.warn(`[NoticeQueue] ⚠️ 评审组员通知完毕但不满足！缺额 ${memberNum - confirmedMember} 人，状态流转为 241 (CREW_EXTRACTING_NOTICE_DONE_BUT_NOT_SATISFIED)`)
          await pool.query(`UPDATE extract_rule SET extracting_state = 241 WHERE id = ?`, [rId])
        }
      }
    } catch (e: any) {
      console.error('[NoticeQueue] 组完成度核查异常:', e.message)
    }
  }
}

export const noticeQueueService = new NoticeQueueService()
