/**
 * 文件作用：XMA 本地 Control Plane 的最小 HTTP 入口。
 * 关联模块：未来 CLI/Desktop/Web、core Agent Runtime。
 * 当前实现：只提供 /health，证明 Shell 与 Core 可以独立运行。
 * 职责边界：0.1.0 不伪造 Agent API；真实 Run/Session API 后续接 Core 后再开放。
 */

import { createServer } from 'node:http'

const host = process.env.XMA_HOST ?? '127.0.0.1'
const port = Number(process.env.XMA_PORT ?? 32123)

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ name: 'XMA', version: '0.1.0', ready: true }))
    return
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: 'not_found' }))
})

server.listen(port, host, () => {
  console.log(`XMA server skeleton: http://${host}:${port}`)
})
