import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './productImport.js'

const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
const formatMessage = '请选择 PNG、JPEG 或 WebP 格式的截图。'
const bytesOf = (input) => input instanceof Uint8Array ? input : new Uint8Array(input)
const ascii = (bytes, offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count))

export function detectScreenshotMime(input) {
  const bytes = bytesOf(input)
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return ''
}

function isComplete(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === 'image/jpeg') {
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false
    // 图像尺寸所在的 SOF 段和扫描数据 SOS 均须在声明的段边界内。
    let frame = false
    for (let i = 2; i + 3 < bytes.length && bytes[i] === 255;) {
      if (bytes[i + 1] === 255) { i++; continue }
      const marker = bytes[i + 1]
      const length = view.getUint16(i + 2)
      if (length < 2 || i + 2 + length > bytes.length - 2) return false
      if (marker === 218) return frame && i + 2 + length < bytes.length - 2
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        frame = length >= 8 && view.getUint16(i + 5) > 0 && view.getUint16(i + 7) > 0
      }
      i += 2 + length
    }
    return false
  }
  if (mime === 'image/png') {
    if (bytes.length < 45 || view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR'
      || !view.getUint32(16) || !view.getUint32(20)) return false
    let pixels = false
    for (let i = 8; i + 12 <= bytes.length;) {
      const size = view.getUint32(i)
      const kind = ascii(bytes, i + 4, 4)
      i += 12 + size
      if (i > bytes.length) return false
      if (kind === 'IDAT' && size) pixels = true
      if (kind === 'IEND') return pixels && size === 0 && i === bytes.length
    }
    return false
  }
  if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) return false
  let pixels = false
  for (let i = 12; i < bytes.length;) {
    if (i + 8 > bytes.length) return false
    const kind = ascii(bytes, i, 4)
    const size = view.getUint32(i + 4, true)
    i += 8 + size + (size % 2)
    if (i > bytes.length) return false
    if (['VP8 ', 'VP8L', 'ANMF'].includes(kind) && size) pixels = true
  }
  return pixels
}

export function screenshotFileError(input, declaredType = '', filename = '') {
  const bytes = bytesOf(input)
  if (bytes.length > MAX_IMAGE_BYTES) return '截图超过 20 MB，请裁剪或压缩后再试。'
  const mime = detectScreenshotMime(bytes)
  if (!mime) return formatMessage
  const ext = filename.match(/\.([^.]+)$/u)?.[1].toLowerCase()
  const type = declaredType.toLowerCase()
  if ((type && type !== 'application/octet-stream' && type !== mime) || (ext && extensions[ext] !== mime)) {
    return '截图的文件类型或扩展名与内容不一致，请重新导出为 PNG、JPEG 或 WebP。'
  }
  return isComplete(bytes, mime) ? '' : '截图文件不完整或已损坏，请重新导出。'
}

export class ScreenshotImageError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export function validateScreenshotDataUrl(image) {
  if (typeof image !== 'string') throw new ScreenshotImageError(formatMessage)
  if (image.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 30) throw new ScreenshotImageError('截图超过 20 MB。', 413)
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(image)
  if (!match || !IMAGE_TYPES.includes(match[1]) || match[2].length % 4) throw new ScreenshotImageError(formatMessage)
  const encoded = match[2]
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  if (encoded.length / 4 * 3 - padding > MAX_IMAGE_BYTES) throw new ScreenshotImageError('截图超过 20 MB。', 413)
  let bytes
  if (Uint8Array.fromBase64) {
    bytes = Uint8Array.fromBase64(encoded)
  } else {
    const data = atob(encoded)
    bytes = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
  }
  const message = screenshotFileError(bytes, match[1])
  if (message) throw new ScreenshotImageError(message)
}
