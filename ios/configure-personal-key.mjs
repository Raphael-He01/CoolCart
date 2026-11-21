import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const device = process.argv[2]
if (!device || process.argv.length !== 3) {
  console.error('用法：node ios/configure-personal-key.mjs <已配对的 iPhone 名称或设备标识>')
  process.exit(1)
}
const root = fileURLToPath(new URL('../', import.meta.url))
const key = loadEnv('development', root, 'DEEPSEEK_API_KEY').DEEPSEEK_API_KEY
if (!key || !/^[!-~]{1,4096}$/.test(key)) {
  console.error('请先在项目的 .env.local 中配置 DEEPSEEK_API_KEY。')
  process.exit(1)
}
const app = 'com.crosspointx.coolcart'
const container = ['--domain-type', 'appDataContainer', '--domain-identifier', app]
const transfer = 'tmp/CoolCartPersonalImport.key'
const receipt = 'tmp/CoolCartPersonalImport.result'
const dir = mkdtempSync(join(tmpdir(), 'coolcart-personal-'))
const secretFile = join(dir, 'transfer')
const statusFile = join(dir, 'receipt')
const childEnv = { ...process.env }
delete childEnv.DEEPSEEK_API_KEY

function deviceCommand([group, command, ...options]) {
  execFileSync('xcrun', ['devicectl', 'device', group, command, '--device', device, '--timeout', '12', '--quiet', ...options],
    { env: childEnv, stdio: 'ignore' })
}
function send(local, remote) {
  deviceCommand(['copy', 'to', ...container, '--source', local, '--destination', remote])
}

let delivered = false
try {
  writeFileSync(statusFile, 'pending', { mode: 0o600 })
  send(statusFile, receipt)
  writeFileSync(secretFile, key, { mode: 0o600 })
  delivered = true
  send(secretFile, transfer)
  rmSync(secretFile)
  deviceCommand(['process', 'launch', '--terminate-existing', app])
  let status = 'pending'
  for (let n = 0; n < 20 && status === 'pending'; n++) {
    await delay(300)
    deviceCommand(['copy', 'from', ...container, '--source', receipt, '--destination', statusFile])
    status = readFileSync(statusFile, 'utf8').trim()
  }
  if (status !== 'ready') throw new Error()
  delivered = false
  console.log('iPhone 已确认个人密钥写入钥匙串。')
} catch {
  if (delivered) {
    try {
      writeFileSync(secretFile, '', { mode: 0o600 })
      send(secretFile, transfer)
    } catch { /* 下次启动开发版时会处理设备上的临时文件。 */ }
  }
  console.error('未收到钥匙串写入确认。请确认 iPhone 已解锁、配对，并已安装当前 Debug 版。')
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
