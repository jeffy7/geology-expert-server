import net from 'net'
import { pool } from '../config/db'
import type { RowDataPacket } from 'mysql2'

export interface ActiveCallMeta {
  callId: string
  phone: string
  extractRuleResultId?: number
  startTime: number
}

class VoiceBoxService {
  private host: string
  private port: number
  private devicename: string
  private socket: net.Socket | null = null
  private isConnected = false
  private isHandshaked = false
  private buffer = Buffer.alloc(0)
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private activeCalls = new Map<string, ActiveCallMeta>() // phone -> ActiveCallMeta
  private currentCall: ActiveCallMeta | null = null

  constructor() {
    this.host = process.env.VOICEBOX_HOST || '192.168.2.4'
    this.port = Number(process.env.VOICEBOX_PORT) || 8555
    this.devicename = process.env.VOICEBOX_DEVICE_NAME || 'EV982EEA9821560762'
  }

  /**
   * 启动语音盒子连接
   */
  public start() {
    if (this.socket) return
    this.connect()
  }

  private connect() {
    console.log(`[VoiceBox-IoT] 正在连接硬件语音盒子 ${this.host}:${this.port}...`)
    this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
      this.isConnected = true
      this.buffer = Buffer.alloc(0)
      console.log(`[VoiceBox-IoT] TCP 链路已建立，开始 WebSocket 协议握手...`)

      const handshake = [
        'GET /api HTTP/1.1',
        `Host: ${this.host}:${this.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '\r\n'
      ].join('\r\n')

      this.socket?.write(handshake)
    })

    this.socket.on('data', (chunk) => {
      this.handleData(chunk)
    })

    this.socket.on('error', (err) => {
      console.warn(`[VoiceBox-IoT] 盒子通信异常:`, err.message)
    })

    this.socket.on('close', () => {
      console.warn(`[VoiceBox-IoT] 盒子连接已断开，5秒后自动重连...`)
      this.cleanup()
      this.scheduleReconnect()
    })
  }

  private cleanup() {
    this.isConnected = false
    this.isHandshaked = false
    this.socket = null
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 5000)
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])

    // 1. 处理 WebSocket 101 握手
    if (!this.isHandshaked) {
      const str = this.buffer.toString()
      const endIdx = str.indexOf('\r\n\r\n')
      if (endIdx !== -1) {
        if (str.includes('101 Switching Protocols')) {
          this.isHandshaked = true
          this.buffer = this.buffer.subarray(endIdx + 4)
          console.log(`[VoiceBox-IoT] ✅ WebSocket 握手成功！开始初始化硬件设备...`)

          // 下发设备开启指令
          this.sendWsJson({ command: 'OpenDevice_Multi' })

          // 开启 30 秒心跳
          this.heartbeatTimer = setInterval(() => {
            this.sendWsRaw('HeartBeatData')
          }, 30000)
        } else {
          console.error(`[VoiceBox-IoT] ❌ 握手失败，响应头:`, str)
          this.socket?.destroy()
          return
        }
      } else {
        return
      }
    }

    // 2. 解码 WebSocket 数据帧
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0]
      const secondByte = this.buffer[1]
      let length = secondByte & 0x7f
      let offset = 2

      if (length === 126) {
        if (this.buffer.length < 4) break
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) break
        length = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }

      if (this.buffer.length < offset + length) {
        break // 缓冲区半包，等待后续数据
      }

      const payload = this.buffer.subarray(offset, offset + length)
      this.buffer = this.buffer.subarray(offset + length)

      const opcode = firstByte & 0x0f
      if (opcode === 0x01) { // 文本帧
        const text = payload.toString('utf-8')
        this.processBoxMessage(text)
      } else if (opcode === 0x08) { // 关闭帧
        this.socket?.destroy()
      }
    }
  }

  /**
   * 处理盒子返回的业务事件报文
   */
  private processBoxMessage(text: string) {
    try {
      const data = JSON.parse(text)
      const msgType = data.type || ''

      // 1. 设备初始化响应
      if (msgType === 'CommandResponse' && data.data?.invoke_command === 'OpenDevice_Multi') {
        if (data.devicename) {
          this.devicename = data.devicename
        }
        console.log(`[VoiceBox-IoT] 硬件就绪，设备号: ${this.devicename}, 状态: ${data.data?.state}`)
        return
      }

      // 2. 捕获专家按键事件 (DTMF)
      if (msgType === 'DTMF' || data.keypress) {
        const key = String(data.dynamicdata?.keypress || data.keypress || '')
        console.log(`[VoiceBox-IoT] 🎯 捕获到专家手机按键: [ ${key} ]`)
        this.handleKeypressCallback(key, data)
        return
      }

      // 3. 通话实时状态事件
      if (msgType === 'RealTimeState') {
        console.log(`[VoiceBox-IoT] 📞 通话状态: ${data.message || ''}`)
        return
      }

      console.log(`[VoiceBox-IoT] 收到盒子报文:`, text)
    } catch {
      // 过滤非 JSON 纯文本心跳等回包
    }
  }

  /**
   * 按键业务回调处理：自动驱动数据库与状态变更
   */
  private async handleKeypressCallback(key: string, raw: any) {
    const call = this.currentCall
    const cleanKey = key.trim()
    console.log(`[VoiceBox-IoT] 执行专家按键判定逻辑: key=${cleanKey}, 当前呼叫:`, call)

    // 无论按 1 还是 0，均立即挂断电话释放信道
    this.hangUp()

    if (!call) {
      console.warn('[VoiceBox-IoT] 收到按键回调，但未匹配到正在进行的呼叫会话')
      return
    }

    try {
      const isAgree = cleanKey === '1'
      const isReject = cleanKey === '0' || cleanKey === '2'

      const participateState = isAgree ? 1 : isReject ? 0 : null
      const remark = isAgree ? '专家按 1 同意参加' : isReject ? '专家按 0/2 放弃参加' : `收到其他按键: ${cleanKey}`

      // 1. 更新抽取结果表 extract_rule_result
      if (call.extractRuleResultId && participateState !== null) {
        await pool.query(
          `UPDATE extract_rule_result 
           SET participate_state = ?, confirm_date = NOW() 
           WHERE id = ?`,
          [participateState, call.extractRuleResultId]
        )

        // 若同意参加，锁定专家
        if (isAgree) {
          const [resRows] = await pool.query<RowDataPacket[]>(
            `SELECT ei_id FROM extract_rule_result WHERE id = ?`,
            [call.extractRuleResultId]
          )
          const eiId = resRows[0]?.ei_id
          if (eiId) {
            await pool.query(
              `UPDATE expert_info_base SET is_locked = 1 WHERE id = ?`,
              [eiId]
            ).catch(e => console.warn('[VoiceBox-IoT] 锁定专家失败:', e.message))
            console.log(`[VoiceBox-IoT] ✅ 专家 (ei_id=${eiId}) 已同意参加并成功锁定`)
          }
        }
      }

      // 2. 更新通知流水表 notice_expert_callback
      await pool.query(
        `UPDATE notice_expert_callback
         SET voicekey_callback = ?, remark = ?, last_update_time = NOW()
         WHERE call_id = ?`,
        [JSON.stringify({ keypress: cleanKey, raw }), remark, call.callId]
      )

      console.log(`[VoiceBox-IoT] ✅ 数据库流水更新完毕: callId=${call.callId}, 结果=${remark}`)
    } catch (err: any) {
      console.error(`[VoiceBox-IoT] 数据库更新异常:`, err.message)
    } finally {
      this.currentCall = null
    }
  }

  /**
   * 发起拨号呼叫
   */
  public async dial(phone: string, meta?: { extractRuleResultId?: number, callId?: string }): Promise<{ success: boolean, callId: string, message: string }> {
    const cleanPhone = phone.replace(/^\+86/, '').trim()
    const callId = meta?.callId || `vb-${Date.now()}-${Math.floor(Math.random() * 10000)}`

    if (!this.isConnected || !this.isHandshaked) {
      return {
        success: false,
        callId,
        message: '语音盒子未连接，请检查网线与 IP'
      }
    }

    const callMeta: ActiveCallMeta = {
      callId,
      phone: cleanPhone,
      extractRuleResultId: meta?.extractRuleResultId,
      startTime: Date.now()
    }
    this.currentCall = callMeta
    this.activeCalls.set(cleanPhone, callMeta)

    console.log(`[VoiceBox-IoT] 📞 发起外呼: 手机号=${cleanPhone}, 设备号=${this.devicename}, callId=${callId}`)

    const dialPayload = {
      command: 'Dial_Multi',
      arguments: {
        phone: cleanPhone,
        devicename: this.devicename
      }
    }

    this.sendWsJson(dialPayload)

    return {
      success: true,
      callId,
      message: `已向语音盒子下发外呼指令 (${cleanPhone})`
    }
  }

  /**
   * 挂断当前通话
   */
  public hangUp() {
    console.log(`[VoiceBox-IoT] 📴 发送挂断电话指令...`)
    const hangupPayload = {
      command: 'HangUp_Multi',
      arguments: {
        devicename: this.devicename
      }
    }
    this.sendWsJson(hangupPayload)
  }

  /**
   * 发送 WebSocket 文本帧（客户端必须做 Masking 掩码）
   */
  private sendWsJson(data: any) {
    this.sendWsRaw(JSON.stringify(data))
  }

  private sendWsRaw(text: string) {
    if (!this.socket || !this.isConnected || !this.isHandshaked) return

    const payload = Buffer.from(text, 'utf-8')
    const length = payload.length
    let header: Buffer

    if (length <= 125) {
      header = Buffer.from([0x81, 0x80 | length, 0, 0, 0, 0])
    } else if (length <= 65535) {
      header = Buffer.alloc(8)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(length, 2)
      header.fill(0, 4, 8)
    } else {
      header = Buffer.alloc(14)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(length), 2)
      header.fill(0, 10, 14)
    }

    this.socket.write(Buffer.concat([header, payload]))
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      handshaked: this.isHandshaked,
      host: this.host,
      port: this.port,
      devicename: this.devicename,
      currentCall: this.currentCall
    }
  }
}

export const voiceBoxService = new VoiceBoxService()
