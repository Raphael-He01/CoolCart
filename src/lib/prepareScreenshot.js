import { MAX_IMAGE_BYTES } from './productImport.js'
import { detectScreenshotMime, screenshotFileError } from './screenshotImage.js'

// 3 MiB 图像的 Base64 JSON 约 4.2 MB，低于团队接口的默认网关上限。
const TEAM_IMAGE_BYTES = 3 * 1024 * 1024

function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('截图读取失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
}

function encode(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function fitTeamUpload(file) {
  const image = new Image()
  const url = URL.createObjectURL(file)
  const canvas = document.createElement('canvas')
  try {
    image.src = url
    await image.decode()
    const { naturalWidth: width, naturalHeight: height } = image
    // 保持比例；限制画布的像素总数和单边尺寸，避免手机创建超大画布而失败。
    let scale = Math.min(1, Math.sqrt(16 * 1024 * 1024 / (width * height)), 8192 / Math.max(width, height))
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        scale *= 0.7
        continue
      }
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      if (attempt === 0) {
        // 单色界面和带大段元数据的截图常可在这一轮无损达标。
        const lossless = await encode(canvas, 'image/png')
        if (lossless?.size && lossless.size <= TEAM_IMAGE_BYTES) return lossless
      }
      context.globalCompositeOperation = 'destination-over'
      context.fillStyle = 'white'
      context.fillRect(0, 0, canvas.width, canvas.height)
      const jpeg = await encode(canvas, 'image/jpeg', 0.9)
      if (jpeg?.size && jpeg.size <= TEAM_IMAGE_BYTES) return jpeg
      scale *= jpeg?.size ? Math.min(0.9, 0.96 * Math.sqrt(TEAM_IMAGE_BYTES / jpeg.size)) : 0.7
    }
    throw new Error('截图处理失败')
  } catch {
    throw new Error('这张截图未能处理，请裁出商品区域或重新导出图片。')
  } finally {
    canvas.width = 0
    canvas.height = 0
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

export async function prepareScreenshot(file, direct = false) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('截图超过 20 MB，请裁剪后重试。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const error = screenshotFileError(bytes, file.type, file.name)
  if (error) throw new Error(error)
  const original = file.slice(0, file.size, detectScreenshotMime(bytes))
  const output = direct || file.size <= TEAM_IMAGE_BYTES ? original : await fitTeamUpload(original)
  return imageData(output)
}
