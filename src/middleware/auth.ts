import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { errorResponse } from '../types'

export const JWT_SECRET = 'geology-expert-jwt-secret-2026'

export interface AuthenticatedUser {
  sub: string
  aud: string
  username: string
  role: string
  roleId: string
  realName: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    res.status(401).json(errorResponse('未提供有效身份凭证 (Token 缺失)', 401))
    return
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json(errorResponse('身份凭证已过期或无效，请重新登录', 401))
      return
    }
    req.user = decoded as AuthenticatedUser
    next()
  })
}
