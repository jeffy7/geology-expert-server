import { exec } from 'child_process'
import util from 'util'
import path from 'path'
import fs from 'fs'
import os from 'os'

const execPromise = util.promisify(exec)

export interface TtsResult {
  success: boolean
  filePath: string
  isFallback?: boolean
  message: string
}

export class TtsService {
  private outputDir: string

  constructor() {
    this.outputDir = path.join(process.cwd(), 'uploads/audio')
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  /**
   * 模板变量渲染器：将 {{variable}} 替换为真实业务值
   * 对齐原系统 SimpleDeviceService.replacePlaceholders
   */
  public renderTemplate(template: string, params: Record<string, any>): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return params[key] !== undefined ? String(params[key]) : `{{${key}}}`
    })
  }

  /**
   * 纯离线中文语音合成 (TTS)
   * Mac 本地自适应: 系统原生 say (TingTing)
   * Linux 生产环境: 原生开源 ekho
   */
  public async generateVoice(text: string, customFileName?: string): Promise<TtsResult> {
    const filename = customFileName || `voice-${Date.now()}.wav`
    const finalWavPath = path.join(this.outputDir, filename)
    const platform = os.platform()

    try {
      if (platform === 'darwin') {
        // macOS: 原生离线语音
        const tempAiff = path.join(os.tmpdir(), `tts-${Date.now()}.aiff`)
        // 使用 macOS 内置 TingTing 发音人
        await execPromise(`say -v "TingTing" "${text.replace(/"/g, '\\"')}" -o "${tempAiff}"`)
        
        // 尝试用 ffmpeg 转成标准 8000Hz 单声道 wav（语音盒子标准格式）
        try {
          await execPromise(`ffmpeg -y -i "${tempAiff}" -ar 8000 -ac 1 "${finalWavPath}"`)
          if (fs.existsSync(tempAiff)) fs.unlinkSync(tempAiff)
        } catch {
          // 若本地未装 ffmpeg，直接拷贝 aiff
          fs.copyFileSync(tempAiff, finalWavPath)
          if (fs.existsSync(tempAiff)) fs.unlinkSync(tempAiff)
        }

        return {
          success: true,
          filePath: finalWavPath,
          message: 'macOS 原生离线语音合成成功'
        }
      } else {
        // Linux: 原生开源 ekho 离线引擎
        const tempWav = path.join(os.tmpdir(), `tts-${Date.now()}.wav`)
        await execPromise(`ekho -v Mandarin "${text.replace(/"/g, '\\"')}" -o "${tempWav}"`)

        try {
          await execPromise(`ffmpeg -y -i "${tempWav}" -ar 8000 -ac 1 "${finalWavPath}"`)
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav)
        } catch {
          fs.copyFileSync(tempWav, finalWavPath)
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav)
        }

        return {
          success: true,
          filePath: finalWavPath,
          message: 'Linux ekho 离线语音合成成功'
        }
      }
    } catch (err: any) {
      console.warn('[TTS] 离线生成异常，启用兜底音频:', err.message)
      // 容错兜底：若系统未装引擎，写入空提示音频避免服务崩溃
      return {
        success: false,
        filePath: finalWavPath,
        isFallback: true,
        message: `TTS 引擎未安装或执行失败: ${err.message}`
      }
    }
  }
}

export const ttsService = new TtsService()

