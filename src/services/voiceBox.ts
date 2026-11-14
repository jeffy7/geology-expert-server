import net from 'net'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pool } from '../config/db'
import type { RowDataPacket } from 'mysql2'

export interface ActiveCallMeta {
  callId: string
  phone: string
  extractRuleResultId?: number
  audioUrl?: string   // 接通后播放的语音 URL（服务器生成的 TTS 音频）
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
  private callResolutionResolver: ((res: { status: 'agreed' | 'rejected' | 'no_response', keypress?: string, reason?: string }) => void) | null = null
  private callTimeoutTimer: NodeJS.Timeout | null = null

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

        // 硬件就绪后，立即下发通知音频下载指令，确保 /mnt/webaudiodownload/expert_notice.wav 预先下载就绪
        this.downloadNoticeAudio()
        return
      }

      // 1.1 音频下载结果响应
      if (msgType === 'CommandResponse' && data.data?.invoke_command === 'audiodownload') {
        console.log(`[VoiceBox-IoT] 📥 盒子音频下载状态回包: state=${data.data?.state}, message=${data.message || '下载成功'}`)
        return
      }

      // 2. 捕获专家按键事件 (DTMF)
      if (msgType === 'DTMF' || data.keypress || data.dynamicdata?.dtmf) {
        const key = String(data.dynamicdata?.dtmf || data.dynamicdata?.keypress || data.keypress || '')
        if (key && key !== 'E') {
          console.log(`[VoiceBox-IoT] 🎯 捕获到专家手机按键: [ ${key} ]`)
          this.handleKeypressCallback(key, data)
          return
        }
      }

      // 3. 通话实时状态事件
      if (msgType === 'RealTimeState') {
        const dynamicdata = data.dynamicdata || {}
        const realtimestate = String(dynamicdata.realtimestate || dynamicdata.state || '').toLowerCase()
        const stateMsg = String(data.message || dynamicdata.message || '')
        console.log(`[VoiceBox-IoT] 📞 通话状态事件: realtimestate=${realtimestate}, message=${stateMsg}, raw=${JSON.stringify(dynamicdata)}`)

        // 呼出中：按原厂规范下发 closeheadsettochannel_Multi 切换信道（启用硬件 DTMF 按键检测）
        if (realtimestate === 'outgoing') {
          console.log(`[VoiceBox-IoT] 🔌 正在下发 closeheadsettochannel_Multi 切换音频通道（启用 DTMF 采样）...`)
          this.sendWsJson({
            command: 'closeheadsettochannel_Multi',
            arguments: { devicename: this.devicename }
          })
        }

        // 呼入自动接听（方便用户主动拨打盒子测试语音）
        if (realtimestate === 'incoming') {
          console.log(`[VoiceBox-IoT] 📥 检测到电话呼入 (${dynamicdata.number || ''})，自动下发 Answer_Multi 接听测试...`)
          this.sendWsJson({
            command: 'Answer_Multi',
            arguments: { devicename: this.devicename }
          })
          return
        }

        // 检测到接通（呼出接通 outconnected / 呼入接听 inconnected / connected / 包含接听），立即播放通知语音
        if (
          realtimestate === 'outconnected' ||
          realtimestate === 'inconnected' ||
          realtimestate === 'connected' ||
          realtimestate === '4' ||
          stateMsg.includes('接听') ||
          stateMsg.includes('接通')
        ) {
          console.log(`[VoiceBox-IoT] 🔊 通话已接通 (${realtimestate})，立即向盒子下发 PlayStartRecord_Multi 播音指令...`)
          this.playNoticeAudio()
        }

        // 检测到挂断 / 闲置 (idle, hangup, disconnected, 0, 挂断)
        if (
          realtimestate === 'idle' ||
          realtimestate === 'hangup' ||
          realtimestate === 'disconnected' ||
          realtimestate === '0' ||
          stateMsg.includes('挂断') ||
          stateMsg.includes('空闲') ||
          stateMsg.includes('结束')
        ) {
          if (this.currentCall && this.callResolutionResolver) {
            // 延时 1.5 秒，避免按键事件比挂断包微延迟到达
            setTimeout(() => {
              if (this.callResolutionResolver) {
                console.log(`[VoiceBox-IoT] 📴 通话已挂断且未收到确认按键，触发无应答流转`)
                const resolver = this.callResolutionResolver
                this.callResolutionResolver = null
                if (this.callTimeoutTimer) {
                  clearTimeout(this.callTimeoutTimer)
                  this.callTimeoutTimer = null
                }
                this.currentCall = null
                resolver({
                  status: 'no_response',
                  reason: '通话挂断无按键响应'
                })
              }
            }, 1500)
          }
        }
        return
      }

      // 4. 放音状态事件 (PlayState) 播完后恢复双向信道监听按键
      if (msgType === 'PlayState') {
        const dyn = data.dynamicdata || {}
        const isPlaying = String(dyn.isplaying) === 'true'
        if (!isPlaying) {
          console.log(`[VoiceBox-IoT] ⏹ 语音播放完毕，切回双向通道监听专家手机按键...`)
          this.sendWsJson({
            command: 'openheadsettochannel_Multi',
            arguments: { devicename: this.devicename }
          })
          this.sendWsJson({
            command: 'openchanneltoheadset_Multi',
            arguments: { devicename: this.devicename }
          })
        }
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
    const cleanKey = key.trim()
    console.log(`[VoiceBox-IoT] 执行专家按键判定逻辑: key=${cleanKey}, 当前呼叫:`, this.currentCall)

    // 无论按 1 还是 0，均立即挂断电话释放信道
    this.hangUp()

    let call = this.currentCall
    if (!call) {
      console.warn('[VoiceBox-IoT] 收到按键回调，尝试匹配最近通知中的抽取记录...')
      try {
        const [latest] = await pool.query<RowDataPacket[]>(
          `SELECT id, ei_phone FROM extract_rule_result WHERE notice_state = 1 ORDER BY last_update_time DESC, id DESC LIMIT 1`
        )
        if (latest && latest[0]) {
          call = {
            callId: `vb-fallback-${latest[0].id}`,
            phone: latest[0].ei_phone,
            extractRuleResultId: latest[0].id,
            startTime: Date.now()
          }
          console.log('[VoiceBox-IoT] 成功匹配到最近待确认记录:', call)
        }
      } catch (err: any) {
        console.warn('[VoiceBox-IoT] 匹配失败:', err.message)
      }
    }

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
           SET participate_state = ?, notice_state = 2, confirm_date = NOW() 
           WHERE id = ?`,
          [participateState, call.extractRuleResultId]
        )

        // 同意参加：锁定专家 (字段为 if_lock)
        const [resRows] = await pool.query<RowDataPacket[]>(
          `SELECT ei_id FROM extract_rule_result WHERE id = ?`,
          [call.extractRuleResultId]
        )
        const eiId = resRows[0]?.ei_id
        if (eiId) {
          await pool.query(
            `UPDATE expert_info_base SET if_lock = ? WHERE id = ?`,
            [isAgree ? 1 : 0, eiId]
          ).catch(e => console.warn('[VoiceBox-IoT] 更新专家锁定状态失败:', e.message))
          console.log(`[VoiceBox-IoT] ✅ 专家 (ei_id=${eiId}) 状态已更新为 if_lock=${isAgree ? 1 : 0}`)
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

      // 触发外部等待该通话完成的队列调度器
      if (this.callResolutionResolver) {
        const resolver = this.callResolutionResolver
        this.callResolutionResolver = null
        if (this.callTimeoutTimer) {
          clearTimeout(this.callTimeoutTimer)
          this.callTimeoutTimer = null
        }
        resolver({
          status: isAgree ? 'agreed' : isReject ? 'rejected' : 'no_response',
          keypress: cleanKey,
          reason: remark
        })
      }
    } catch (err: any) {
      console.error(`[VoiceBox-IoT] 数据库更新异常:`, err.message)
    } finally {
      this.currentCall = null
    }
  }

  /**
   * 阻塞等待当前外呼结束或收到按键回调 (用于队列调度顺序呼叫与 5 秒延时控制)
   */
  public waitForCallResolution(timeoutMs = 50000): Promise<{ status: 'agreed' | 'rejected' | 'no_response', keypress?: string, reason?: string }> {
    return new Promise((resolve) => {
      this.callResolutionResolver = resolve
      this.callTimeoutTimer = setTimeout(() => {
        if (this.callResolutionResolver) {
          console.warn('[VoiceBox-IoT] ⏰ 通话等待超时 (50秒未响应)，主动挂机释放信道...')
          this.hangUp()
          const resolver = this.callResolutionResolver
          this.callResolutionResolver = null
          this.callTimeoutTimer = null
          this.currentCall = null
          resolve({
            status: 'no_response',
            reason: '呼叫超时无应答'
          })
        }
      }, timeoutMs)
    })
  }

  /**
   * 发起拨号呼叫
   */
  public async dial(phone: string, meta?: { extractRuleResultId?: number, callId?: string, audioUrl?: string }): Promise<{ success: boolean, callId: string, message: string }> {
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
      audioUrl: meta?.audioUrl,
      startTime: Date.now()
    }
    this.currentCall = callMeta
    this.activeCalls.set(cleanPhone, callMeta)

    console.log(`[VoiceBox-IoT] 📞 发起外呼: 手机号=${cleanPhone}, 设备号=${this.devicename}, callId=${callId}`)

    // 1. 发起拨号呼叫
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
   * 触发语音盒子将通知音频下载至盒子内部本地存储 (/mnt/webaudiodownload/)
   * 按照原工程标准参数: url, content, devicename
   */
  /**
   * 触发语音盒子将通知音频下载至盒子内部存储 (/mnt/webaudiodownload/)
   * 对齐原工程两阶段确认机制: audiodownload (content传MD5) -> 延时 -> CheckAudioDownload
   */
  public downloadNoticeAudio(customFileName = 'expert_notice.wav') {
    const audioUrl = process.env.VOICEBOX_AUDIO_URL || 'http://192.168.2.1:8085/expert_notice.wav'
    
    // 计算本地音频文件 MD5 (原厂硬件固件校验规则)
    let md5 = '4424b72e4797d8cd5b14b95cc6614193'
    try {
      const localFilePath = path.join(process.cwd(), 'uploads/audio', customFileName)
      if (fs.existsSync(localFilePath)) {
        const fileBuf = fs.readFileSync(localFilePath)
        md5 = crypto.createHash('md5').update(fileBuf).digest('hex')
      }
    } catch (e: any) {
      console.warn('[VoiceBox-IoT] 计算音频 MD5 异常:', e.message)
    }

    console.log(`[VoiceBox-IoT] 📥 1. 下发盒子内部音频下载指令: url=${audioUrl}, content(MD5)=${md5}`)
    this.sendWsJson({
      command: 'audiodownload',
      arguments: {
        url: audioUrl,
        content: md5,
        devicename: this.devicename
      }
    })

    // 延时 4 秒后主动向盒子校验下载状态 CheckAudioDownload (原工程标准)
    setTimeout(() => {
      console.log(`[VoiceBox-IoT] 🔍 2. 下发 CheckAudioDownload 校验文件状态: content=${customFileName}`)
      this.sendWsJson({
        command: 'CheckAudioDownload',
        arguments: {
          content: customFileName,
          devicename: this.devicename
        }
      })
    }, 4000)
  }

  /**
   * 接通后播放通知语音
   * 盒子在收到 audiodownload 后保存在 /mnt/webaudiodownload/，此处 content 必须传文件名
   */
  private playNoticeAudio() {
    console.log(`[VoiceBox-IoT] 🔊 发送播音指令: PlayStartRecord_Multi, devicename=${this.devicename}, content=expert_notice.wav`)

    // 下发 PlayStartRecord_Multi 指令 (原系统标准指令，content 仅传文件名)
    this.sendWsJson({
      command: 'PlayStartRecord_Multi',
      arguments: {
        devicename: this.devicename,
        content: 'expert_notice.wav'
      }
    })
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
