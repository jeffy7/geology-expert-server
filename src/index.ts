import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth'
import projectRoutes from './routes/project'
import expertRoutes from './routes/expert'
import { successResponse, errorResponse } from './types'

const app = express()
const PORT = 8080

// 中间件配置
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 统一日志记录
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`)
  next()
})

// 健康检查
app.get('/etbApi/health', (_req, res) => {
  res.json(successResponse({
    status: 'UP',
    version: '1.0.0',
    system: '内蒙古自治区地调院矿产专家抽取复刻系统',
    mockVmsEnabled: true,
    timestamp: new Date().toISOString()
  }, '系统服务运行正常'))
})

// 路由挂载 (统一收敛至 /etbApi/ 前缀)
app.use('/etbApi/etbuser', authRoutes)
app.use('/etbApi/project', projectRoutes)
app.use('/etbApi/expert', expertRoutes)
app.use('/etbApi/expert-notice', expertRoutes)

// 404 处理
app.use((req, res) => {
  res.status(404).json(errorResponse(`API 接口不存在: ${req.method} ${req.url}`, 404))
})

// 全局异常捕获中间件
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json(errorResponse(err.message || '内部服务处理异常', 500))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`)
  console.log(` 🚀 地调院专家系统后端单体服务已成功启动！`)
  console.log(` 📡 监听端口: http://127.0.0.1:${PORT}`)
  console.log(` 🔑 统一API根路径: http://127.0.0.1:${PORT}/etbApi`)
  console.log(` 🩺 服务自检: http://127.0.0.1:${PORT}/etbApi/health`)
  console.log(`=======================================================`)
})
