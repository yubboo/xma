/**
 * 文件作用：XMA 本地/云端 Control Plane 的最小 HTTP 入口，并为 `xiaoyu web` 提供可选静态 Web Shell 托管。
 * 关联模块：apps/cli、apps/web、未来 App Protocol、core Agent Runtime。
 * 当前实现：/health、可选 XIAOYU_WEB_ROOT 静态文件服务、SPA fallback 与安全路径约束。
 * 职责边界：Server 只做传输与静态资源外壳；0.1.x 不伪造未实现的 Agent API，真实 Run/Session API 必须接 Core 后再开放。
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { createServer } from 'node:http'

const host = process.env.XMA_HOST ?? process.env.XIAOYU_HOST ?? '127.0.0.1'
const port = Number(process.env.XMA_PORT ?? process.env.XIAOYU_PORT ?? 32123)
const webRoot = process.env.XIAOYU_WEB_ROOT ? resolve(process.env.XIAOYU_WEB_ROOT) : undefined

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function insideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

async function staticFile(urlPath: string): Promise<string | undefined> {
  if (!webRoot) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  } catch {
    return undefined
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = resolve(webRoot, relative)
  if (!insideRoot(webRoot, candidate)) return undefined
  try {
    if ((await stat(candidate)).isFile()) return candidate
  } catch {
    // SPA 路由由 index.html 接管；找不到静态文件不是 Server 错误。
  }
  const index = resolve(webRoot, 'index.html')
  if (!insideRoot(webRoot, index)) return undefined
  try {
    return (await stat(index)).isFile() ? index : undefined
  } catch {
    return undefined
  }
}

const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ name: 'XMA', version: '0.1.0', ready: true, web: Boolean(webRoot) }))
    return
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const file = await staticFile(request.url ?? '/')
    if (file) {
      response.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      })
      if (request.method === 'HEAD') response.end()
      else createReadStream(file).pipe(response)
      return
    }
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: 'not_found' }))
})

server.listen(port, host, () => {
  console.log(`XMA server: http://${host}:${port}${webRoot ? ` (web=${webRoot})` : ''}`)
})
