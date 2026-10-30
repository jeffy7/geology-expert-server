export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
  success: boolean
}

export const successResponse = <T>(data: T, message = '操作成功'): ApiResponse<T> => ({
  code: 200,
  message,
  data,
  success: true
})

export const errorResponse = (message = '系统异常', code = 500): ApiResponse<null> => ({
  code,
  message,
  data: null,
  success: false
})

