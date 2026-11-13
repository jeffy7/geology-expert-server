// @ts-ignore
import * as tencentcloud from 'tencentcloud-sdk-nodejs'
import http from 'http'
import https from 'https'
import { voiceBoxService } from './voiceBox'

const VmsClient = tencentcloud.vms.v20200902.Client

// 全局外呼与语音盒子配置，1:1 对齐原系统 VmsProperties 与 BeerBraceIotClientProperties
export interface VoiceSystemProperties {
  channel: 'voicebox' | 'tencent' | 'test'
  secretId: string
  secretKey: string
  templateId: string
  voiceSdkAppid: string
  region: string
  playTimes: number
  retryNum: number
  ignoreRetryFailCodeList: number[]
  quickRetry: boolean
  mockVms: boolean
  mockVmsUrl: string
  agreeKey: number
  rejectKey: number
  delayCheckVMSKeypressStateDelayTime: number
  enableSmsNotice: boolean
  enableStreamListener: boolean
  enableDesensitization: boolean
  // 语音盒子 (IoT 硬件外设) 配置
  voiceBox: {
    enabled: boolean
    host: string
    port: number
    useEpoll: boolean
    voiceFileUri: string
    autoConnect: boolean
    heartBeatReconnect: boolean
    readerIdleTimeSeconds: number
    writerIdleTimeSeconds: number
  }
}

export const vmsConfig: VoiceSystemProperties = {
  channel: (process.env.NOTICE_CHANNEL as any) || (process.env.NOTICE_BEAN_NAME as any) || 'voicebox',
  secretId: process.env.VMS_SECRET_ID || '',
  secretKey: process.env.VMS_SECRET_KEY || '',
  templateId: process.env.VMS_TEMPLATE_ID || '1478260',
  voiceSdkAppid: process.env.VMS_SDK_APP_ID || '1400820243',
  region: process.env.VMS_REGION || 'ap-beijing',
  playTimes: 2,
  retryNum: 3,
  ignoreRetryFailCodeList: [-1001, -1002, 4001, 4002],
  quickRetry: false,
  mockVms: process.env.VMS_MOCK === 'true' || process.env.NODE_ENV !== 'production',
  mockVmsUrl: process.env.MOCK_VMS_URL || 'http://127.0.0.1:8080/etbApi/expert-notice/callback',
  agreeKey: 1,
  rejectKey: 2,
  delayCheckVMSKeypressStateDelayTime: 30000,
  enableSmsNotice: true,
  enableStreamListener: false,
  enableDesensitization: true,
  voiceBox: {
    enabled: process.env.VOICEBOX_ENABLED !== 'false',
    host: process.env.VOICEBOX_HOST || '127.0.0.1',
    port: Number(process.env.VOICEBOX_PORT) || 8089,
    useEpoll: false,
    voiceFileUri: process.env.VOICEBOX_FILE_URI || '/audio/voice-prompt.wav',
    autoConnect: true,
    heartBeatReconnect: true,
    readerIdleTimeSeconds: 60,
    writerIdleTimeSeconds: 30
  }
}

// 初始化腾讯云客户端
const client = new VmsClient({
  credential: {
    secretId: vmsConfig.secretId,
    secretKey: vmsConfig.secretKey
  },
  region: vmsConfig.region,
  profile: {
    httpProfile: {
      endpoint: 'vms.tencentcloudapi.com'
    }
  }
})

export interface VmsCallResult {
  success: boolean
  isMock: boolean
  callId?: string
  message: string
  raw?: any
}

/**
 * 发送 TTS 语音通知（支持语音盒子硬件通道与腾讯云通道）
 * @param calledNumber 被叫手机号
 * @param templateParams 模板变量替换参数
 */
export async function sendTtsVoice(
  calledNumber: string,
  templateParams: string[] = ['地调院矿产专家抽取评审', '2026-11-02']
): Promise<VmsCallResult> {
  const cleanNumber = calledNumber.replace(/^\+86/, '')
  const formattedNumber = `+86${cleanNumber}`

  // 1. 若配置为语音盒子 (voicebox)
  if (vmsConfig.channel === 'voicebox') {
    const callId = `vb-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    console.log(`[VoiceBox-IoT] 正在通过语音盒子呼叫专家: ${cleanNumber}, 语音设备: ${vmsConfig.voiceBox.host}:${vmsConfig.voiceBox.port}`)

    // 优先调用硬件 WebSocket 服务进行真机外呼
    const callResult = await voiceBoxService.dial(cleanNumber, { callId })
    return {
      success: callResult.success,
      isMock: !callResult.success,
      callId: callResult.callId,
      message: callResult.message
    }
  }

  // 2. 若配置为 Mock 模式
  if (vmsConfig.mockVms) {
    console.log(`[VMS-Mock] 模拟语音呼叫专家: ${formattedNumber}, 参数:`, templateParams)
    return {
      success: true,
      isMock: true,
      callId: `mock-call-${Date.now()}`,
      message: 'Mock 模拟外呼已触发'
    }
  }

  // 3. 调用腾讯云真实 VMS API
  console.log(`[VMS-SDK] 正在向腾讯云发起真实外呼: ${formattedNumber}, AppId: ${vmsConfig.voiceSdkAppid}, 模板: ${vmsConfig.templateId}`)
  try {
    const response = await client.SendTtsVoice({
      TemplateId: vmsConfig.templateId,
      CalledNumber: formattedNumber,
      VoiceSdkAppid: vmsConfig.voiceSdkAppid,
      TemplateParamSet: templateParams
    })

    console.log('[VMS-SDK] 腾讯云外呼请求响应成功:', response)
    return {
      success: true,
      isMock: false,
      callId: response.SendStatus?.CallId,
      message: '腾讯云外呼指令已成功下发',
      raw: response
    }
  } catch (error: any) {
    console.error(`[VMS-SDK] 腾讯云外呼失败 [${error.code || 'UNKNOWN'}]:`, error.message)
    return {
      success: false,
      isMock: false,
      message: `腾讯云接口调用失败: ${error.message} (${error.code || 'UNKNOWN'})`,
      raw: error
    }
  }
}

/**
 * 发送语音验证码 / 纯数字语音通知 (SendCodeVoice)
 */
export async function sendCodeVoice(
  calledNumber: string,
  code: string
): Promise<VmsCallResult> {
  const formattedNumber = calledNumber.startsWith('+86') ? calledNumber : `+86${calledNumber}`

  if (vmsConfig.mockVms) {
    console.log(`[VMS-Mock] 模拟语音验证码呼叫: ${formattedNumber}, Code: ${code}`)
    return {
      success: true,
      isMock: true,
      callId: `mock-code-${Date.now()}`,
      message: 'Mock 模拟语音验证码已发送'
    }
  }

  try {
    const response = await client.SendCodeVoice({
      CodeMessage: code,
      CalledNumber: formattedNumber,
      VoiceSdkAppid: vmsConfig.voiceSdkAppid
    })

    return {
      success: true,
      isMock: false,
      callId: response.SendStatus?.CallId,
      message: '语音验证码已呼出',
      raw: response
    }
  } catch (error: any) {
    console.error(`[VMS-SDK] 语音验证码外呼失败 [${error.code}]:`, error.message)
    return {
      success: false,
      isMock: false,
      message: `语音验证码呼出异常: ${error.message}`,
      raw: error
    }
  }
}

/**
 * 获取当前外呼配置摘要（脱敏）
 */
export function getVmsConfigSummary() {
  return {
    channel: vmsConfig.channel,
    isMock: vmsConfig.mockVms,
    region: vmsConfig.region,
    voiceSdkAppid: vmsConfig.voiceSdkAppid,
    templateId: vmsConfig.templateId,
    agreeKey: vmsConfig.agreeKey,
    rejectKey: vmsConfig.rejectKey,
    playTimes: vmsConfig.playTimes,
    retryNum: vmsConfig.retryNum,
    voiceBox: vmsConfig.voiceBox,
    secretIdMask: `${vmsConfig.secretId.substring(0, 6)}******${vmsConfig.secretId.substring(vmsConfig.secretId.length - 4)}`
  }
}

/**
 * 打印完整 VmsProperties（原系统标准返回结构）
 */
export function printVmsProperties() {
  return {
    secretId: vmsConfig.secretId,
    secretKey: vmsConfig.secretKey,
    templateId: vmsConfig.templateId,
    voiceSdkAppid: vmsConfig.voiceSdkAppid,
    playTimes: vmsConfig.playTimes,
    retryNum: vmsConfig.retryNum,
    ignoreRetryFailCodeList: vmsConfig.ignoreRetryFailCodeList,
    quickRetry: vmsConfig.quickRetry,
    mockVms: vmsConfig.mockVms,
    mockVmsUrl: vmsConfig.mockVmsUrl,
    agreeKey: vmsConfig.agreeKey,
    rejectKey: vmsConfig.rejectKey,
    delayCheckVMSKeypressStateDelayTime: vmsConfig.delayCheckVMSKeypressStateDelayTime,
    enableSmsNotice: vmsConfig.enableSmsNotice,
    enableStreamListener: vmsConfig.enableStreamListener,
    enableDesensitization: vmsConfig.enableDesensitization,
    voiceBox: vmsConfig.voiceBox
  }
}
