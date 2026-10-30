import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

// 创建 MySQL 数据库连接池
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'codepush0',
  database: process.env.DB_NAME || 'geology_expert_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
})

// 测试数据库连通性
export const testDbConnection = async () => {
  try {
    const connection = await pool.getConnection()
    console.log('✅ MySQL 数据库 [geology_expert_db] 真实连接池初始化成功！')
    connection.release()
    return true
  } catch (error) {
    console.error('❌ MySQL 数据库连接失败:', error)
    return false
  }
}

