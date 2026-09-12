/**
 * 文件作用：检查 XMA 仓库卫生规则，防止依赖、构建产物、运行数据、Secret 或安装包进入 Git。
 * 关联模块：.gitignore、XMA-GitHub.bat、scripts/windows/xma-github.ps1、GitHub Actions。
 * 当前实现：验证固定忽略规则，并在 Git 仓库环境中扫描已跟踪文件是否命中禁止路径/扩展。
 * 职责边界：本 Gate 不安装依赖、不修改 Git；Secret 内容扫描由 GitHub Helper 与后续 CI 安全任务负责。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ignore = readFileSync('.gitignore', 'utf8')
const requiredIgnoreRules = [
  'node_modules/', '.pnpm-store/', 'dist/', 'build/', 'coverage/', 'runtime/', '.xma/', 'workspaces/',
  'native/target/', '**/target/', 'apps/desktop/release/', '.env', '*.pem', '*.key', '*.exe', '*.zip',
]
for (const rule of requiredIgnoreRules) {
  if (!ignore.includes(rule)) throw new Error(`仓库忽略规则缺失：${rule}`)
}

const forbidden = (path: string): boolean => {
  const value = path.replaceAll('\\', '/').toLowerCase()
  const dirs = ['node_modules/', '.pnpm-store/', '.cache/', '.turbo/', 'dist/', 'build/', 'coverage/', 'runtime/', '.xma/', 'workspaces/', '/target/', 'native/target/', 'apps/desktop/release/']
  if (dirs.some(dir => value.startsWith(dir) || value.includes(`/${dir}`))) return true
  const name = value.split('/').at(-1) ?? value
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true
  if (['secrets.json', 'credentials.json'].includes(name)) return true
  return ['.log', '.exe', '.msi', '.msix', '.dmg', '.pkg', '.appimage', '.deb', '.rpm', '.zip', '.7z', '.rar', '.pem', '.key', '.pfx', '.p12', '.keystore'].some(ext => name.endsWith(ext))
}

try {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  const bad = tracked.filter(forbidden)
  if (bad.length) throw new Error(`Git 已跟踪禁止文件：\n${bad.map(file => ` - ${file}`).join('\n')}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('not a git repository') && !message.includes('ENOENT')) throw error
}

console.log('XMA Repository Hygiene Gate PASS')
