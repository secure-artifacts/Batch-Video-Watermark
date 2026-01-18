const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const FFmpeg = require('fluent-ffmpeg')
const sharp = require('sharp')
const fs = require('fs')
const os = require('os')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')


const isDev = !app.isPackaged
const binPath = isDev 
  ? path.join(__dirname, 'bin') 
  : path.join(process.resourcesPath, 'app.asar.unpacked', 'bin')

const exeExtension = process.platform === 'win32' ? '.exe' : ''
const ffmpegPath = path.join(binPath, `ffmpeg${exeExtension}`)
const ffprobePath = path.join(binPath, `ffprobe${exeExtension}`)

FFmpeg.setFfmpegPath(ffmpegPath)
FFmpeg.setFfprobePath(ffprobePath)

const fontPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'fonts')

GlobalFonts.registerFromPath(
  path.join(fontPath, 'NotoSerifCJK.ttf'),
  'Noto Sans CJK'
)

GlobalFonts.registerFromPath(
  path.join(fontPath, 'NotoSans.ttf'),
  'Noto Sans'
)

let mainWindow
const tempDirs = new Set()

const CONFIG = {
  PADDING: { x: 10, y: 10 },
  BRIGHTNESS_THRESHOLD: 0.5,
  THUMBNAIL_SIZE: '640x360',
  VIDEO_EXTENSIONS: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm']
}

// 创建临时文件夹用于存放生成的临时文件
async function createTempDir () {
  const dir = path.join(os.tmpdir(), `video-wm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
  await fs.promises.mkdir(dir, { recursive: true })
  tempDirs.add(dir)
  return dir
}

// 清理所有已创建的临时目录，防止磁盘残留
async function cleanupTempDirs () {
  for (const dir of tempDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true })
      tempDirs.delete(dir)
    } catch (err) {
      console.warn(`清理临时文件失败: ${dir}`)
    }
  }
}

/**
 * @description 将十六进制颜色字符串解析为 RGB 对象
 * @param {string} color - 颜色字符串，如 "#FFFFFF"
 * @returns {{r:number,g:number,b:number}} RGB 颜色对象
 */
function parseColor (color) {
  if (!color.startsWith('#')) return { r: 255, g: 255, b: 255 }
  const hex = color.substring(1)
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  }
}

/**
 * @description 根据 RGB 计算亮度值 (0~1)，用于自动选择文字颜色
 * @param {number} r - 红色通道值 (0-255)
 * @param {number} g - 绿色通道值 (0-255)
 * @param {number} b - 蓝色通道值 (0-255)
 * @returns {number} 亮度值 (0~1)
 */
function calculateBrightness (r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * @description 根据亮度值选择合适的字体颜色（深色或浅色）
 * @param {number} brightness - 图像平均亮度 (0~1)
 * @returns {{color:string, type:'light'|'dark'}} 推荐文字颜色及类型
 */
function getColorByBrightness (brightness) {
  const color = brightness > CONFIG.BRIGHTNESS_THRESHOLD ? '#000000' : '#FFFFFF'
  const type = brightness > CONFIG.BRIGHTNESS_THRESHOLD ? 'dark' : 'light'
  return { color, type }
}

/**
 * @description 将文本自动换行以适应最大宽度
 * @param {string} text - 原始文本
 * @param {CanvasRenderingContext2D} ctx - Canvas 渲染上下文
 * @param {number} maxWidth - 文本最大宽度
 * @returns {string[]} 分行后的文本数组
 */
function wrapText (text, ctx, maxWidth) {
  const lines = []
  let currentLine = ''

  for (const char of text) {
    const testLine = currentLine + char
    if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = testLine
    }
  }

  if (currentLine.length > 0) lines.push(currentLine)
  return lines
}

/**
 * @description 生成 FFmpeg overlay 滤镜字符串，用于确定水印在视频中的位置
 * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} position - 水印位置
 * @returns {string} FFmpeg overlay 滤镜表达式
 */
function buildOverlayFilter (position) {
  const { x, y } = CONFIG.PADDING
  const positionMap = {
    'top-left': `overlay=${x}:${y}`,
    'top-right': `overlay=W-w-${x}:${y}`,
    'bottom-left': `overlay=${x}:H-h-${y}`,
    'bottom-right': `overlay=W-w-${x}:H-h-${y}`
  }
  return positionMap[position] || positionMap['bottom-right']
}

/**
 * @description 根据视频尺寸和位置计算分析区域（如提取亮度的区域）
 * @param {string} position - 区域位置
 * @param {number} width - 视频宽度
 * @param {number} height - 视频高度
 * @returns {{left:number,top:number,width:number,height:number}} 区域配置对象
 */
function getRegionConfig (position, width, height) {
  const configs = {
    'top-left': { left: 0, top: 0, width: Math.floor(width * 0.3), height: Math.floor(height * 0.3) },
    'top-right': { left: Math.floor(width * 0.7), top: 0, width: Math.floor(width * 0.3), height: Math.floor(height * 0.3) },
    'bottom-left': { left: 0, top: Math.floor(height * 0.7), width: Math.floor(width * 0.3), height: Math.floor(height * 0.3) },
    'bottom-right': { left: Math.floor(width * 0.7), top: Math.floor(height * 0.7), width: Math.floor(width * 0.3), height: Math.floor(height * 0.3) }
  }
  return configs[position] || configs['bottom-right']
}

/**
 * @description 使用 Canvas 生成带透明度的文字水印图片（PNG）
 * @param {string} text - 水印文字内容
 * @param {number} fontSize - 字体大小
 * @param {string} color - 字体颜色（十六进制）
 * @param {number} opacity - 透明度 (0~1)
 * @param {number} videoWidth - 视频宽度
 * @param {number} videoHeight - 视频高度
 * @returns {Buffer} PNG 图片缓冲区
 */
function generateWatermarkImage (text, fontSize, color, opacity, videoWidth, videoHeight) {
  const { x: paddingX, y: paddingY } = CONFIG.PADDING
  const maxWidth = videoWidth - paddingX * 2

  const tempCanvas = createCanvas(maxWidth, videoHeight)
  const tempCtx = tempCanvas.getContext('2d')
  tempCtx.font = `${fontSize}px "Noto Sans", "Noto Sans CJK"`

  const lines = wrapText(text, tempCtx, maxWidth)
  const lineHeight = fontSize + 8
  const textHeight = lines.length * lineHeight

  let maxLineWidth = 0
  lines.forEach(line => {
    maxLineWidth = Math.max(maxLineWidth, Math.ceil(tempCtx.measureText(line).width))
  })

  const canvasWidth = Math.min(maxLineWidth + 4, maxWidth)
  const canvas = createCanvas(canvasWidth, textHeight + 4)
  const ctx = canvas.getContext('2d')

  ctx.font = `${fontSize}px "Noto Sans", "Noto Sans CJK"`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const { r, g, b } = parseColor(color)
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`

  lines.forEach((line, index) => {
    ctx.fillText(line, 0, index * lineHeight)
  })

  return canvas.toBuffer('image/png')
}

/**
 * @description 获取视频的宽高和时长等基础信息
 * @param {string} videoPath - 视频 file 路径
 * @returns {Promise<{width:number,height:number,duration:number}>}
 */
function getVideoInfo (videoPath) {
  return new Promise((resolve, reject) => {
    FFmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err)
      try {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video')
        if (!videoStream) throw new Error('未找到视频流')
        resolve({
          width: videoStream.width,
          height: videoStream.height,
          duration: metadata.format.duration
        })
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * @description 从视频中提取一帧缩略图，用于颜色分析
 * @param {string} videoPath - 输入视频路径
 * @param {string} outputPath - 缩略图输出路径
 * @returns {Promise<void>}
 */
function extractThumbnail (videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    FFmpeg(videoPath).outputOptions(['-vframes', '1', '-q:v', '2', '-s', CONFIG.THUMBNAIL_SIZE]).output(outputPath).on('error', reject).on('end', resolve).run()
  })
}

/**
 * @description 分析指定图片某一区域的平均颜色及亮度
 * @param {string} imagePath - 图片路径
 * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} position - 分析区域位置
 * @returns {Promise<{color:string,brightness:number,type:string,position:string,averageColor:{r:number,g:number,b:number}}>}
 */
async function analyzeImageColor (imagePath, position) {
  const metadata = await sharp(imagePath).metadata()
  const posConfig = getRegionConfig(position, metadata.width, metadata.height)

  const regionBuffer = await sharp(imagePath).extract(posConfig).raw().toBuffer({ resolveWithObject: true })

  const { data, info } = regionBuffer
  const channels = info.channels

  let r = 0,
    g = 0,
    b = 0,
    count = 0
  for (let i = 0; i < data.length; i += channels) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    count++
  }

  const avgR = Math.round(r / count)
  const avgG = Math.round(g / count)
  const avgB = Math.round(b / count)
  const brightness = calculateBrightness(avgR, avgG, avgB)

  const { color, type } = getColorByBrightness(brightness)
  return { color, brightness, type, position, averageColor: { r: avgR, g: avgG, b: avgB } }
}

/**
 * @description 分析视频某一区域的颜色亮度，用于智能选择文字颜色
 * @param {string} videoPath - 视频路径
 * @param {string} [position='bottom-right'] - 分析区域位置
 * @returns {Promise<{color:string,brightness:number,type:string,position:string}>}
 */
async function analyzeVideoColor (videoPath, position = 'bottom-right') {
  const tempDir = await createTempDir()
  const thumbnailPath = path.join(tempDir, 'thumb.png')
  await extractThumbnail(videoPath, thumbnailPath)
  return await analyzeImageColor(thumbnailPath, position)
}

/**
 * @description 使用 FFmpeg 将生成的水印图层叠加到视频上并输出
 * @param {string} inputPath - 输入视频路径
 * @param {string} outputPath - 输出视频路径
 * @param {Buffer} watermarkBuffer - 水印图片缓冲区
 * @param {string} overlayFilter - FFmpeg overlay 参数
 * @param {Function} progressCallback - 处理进度回调函数
 * @returns {Promise<void>}
 */
function processVideoWithCanvasWatermark (inputPath, outputPath, watermarkBuffer, overlayFilter, progressCallback) {
  return new Promise(async (resolve, reject) => {
    const tempDir = await createTempDir()
    const watermarkImagePath = path.join(tempDir, 'watermark.png')

    try {
      fs.writeFileSync(watermarkImagePath, watermarkBuffer)

      FFmpeg(inputPath)
        .input(watermarkImagePath)
        .complexFilter([overlayFilter])
        .outputOptions(['-c:a', 'aac', '-b:a', '128k', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
        .output(outputPath)
        .on('progress', progress => {
          progressCallback?.(Math.round(progress.percent || 0))
        })
        .on('error', reject)
        .on('end', resolve)
        .run()
    } catch (error) {
      reject(error)
    }
  })
}

// 创建主窗口并加载前端页面
function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 1085,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false
    }
  })
  mainWindow.loadFile('index.html')
}

app.on('ready', createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
app.on('before-quit', cleanupTempDirs)

// 打开文件选择对话框选择视频
ipcMain.handle('select-videos', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: CONFIG.VIDEO_EXTENSIONS }]
  })
  return filePaths
})

/**
 * @description Electron IPC: 分析视频颜色信息（亮度和推荐文字颜色）
 * @param {Electron.IpcMainInvokeEvent} event - IPC 事件对象
 * @param {{videoPath:string,position?:string}|string} params - 视频路径或配置
 * @returns {Promise<Object>} 分析结果
 */
ipcMain.handle('analyze-video-color', async (event, params) => {
  const videoPath = typeof params === 'string' ? params : params.videoPath
  const position = typeof params === 'string' ? 'bottom-right' : params.position || 'bottom-right'
  return await analyzeVideoColor(videoPath, position)
})

/**
 * @description Electron IPC: 批量处理视频，生成带水印的新视频
 * @param {Electron.IpcMainInvokeEvent} event - IPC 事件对象
 * @param {Object} options - 参数配置对象
 * @param {string[]} options.videoFiles - 视频文件路径数组
 * @param {string} options.watermarkText - 水印文字
 * @param {number} options.fontSize - 字体大小
 * @param {string} options.watermarkColor - 字体颜色
 * @param {number} options.opacity - 水印透明度
 * @param {string} options.position - 水印位置
 * @param {boolean} options.enableSmartColor - 是否启用智能颜色分析
 * @returns {Promise<Array>} 处理结果列表
 */
ipcMain.handle('process-videos', async (event, options) => {
  const { videoFiles, watermarkText, fontSize, watermarkColor, opacity, position, enableSmartColor } = options
  const results = []

  for (let i = 0; i < videoFiles.length; i++) {
    const videoFile = videoFiles[i]
    const baseName = path.basename(videoFile)

    try {
      if (!fs.existsSync(videoFile)) throw new Error('文件不存在')

      const videoDir = path.dirname(videoFile)
      const outputFile = path.join(videoDir, `${path.basename(videoFile, path.extname(videoFile))}-watermark.mp4`)

      const info = await getVideoInfo(videoFile)
      let finalColor = watermarkColor
      let colorType = 'manual'

      if (enableSmartColor) {
        mainWindow.webContents.send('processing-status', {
          file: baseName,
          status: 'analyzing',
          index: i,
          total: videoFiles.length
        })

        try {
          const colorResult = await analyzeVideoColor(videoFile, position)
          finalColor = colorResult.color
          colorType = colorResult.type

          mainWindow.webContents.send('color-analyzed', {
            file: baseName,
            color: finalColor,
            brightness: colorResult.brightness,
            type: colorType,
            position: position,
            index: i
          })
        } catch (analyzeError) {
          console.warn(`颜色分析失败: ${analyzeError.message}`)
          mainWindow.webContents.send('color-analyzed', {
            file: baseName,
            color: watermarkColor,
            error: analyzeError.message,
            type: 'original',
            position: position,
            index: i
          })
        }
      }

      const scaledFontSize = Math.round(fontSize * (info.height / 1080))
      const watermarkBuffer = generateWatermarkImage(watermarkText, scaledFontSize, finalColor, opacity, info.width, info.height)

      const overlayFilter = buildOverlayFilter(position)
      await processVideoWithCanvasWatermark(videoFile, outputFile, watermarkBuffer, overlayFilter, progress => {
        mainWindow.webContents.send('processing-progress', {
          file: baseName,
          progress,
          index: i,
          total: videoFiles.length
        })
      })

      results.push({ file: baseName, status: 'success', output: outputFile, color: finalColor, colorType })
      mainWindow.webContents.send('file-completed', { file: baseName, status: 'success', index: i, total: videoFiles.length })
    } catch (error) {
      console.error(`${baseName}: ${error.message}`)
      results.push({ file: baseName, status: 'error', error: error.message })
      mainWindow.webContents.send('file-completed', { file: baseName, status: 'error', error: error.message, index: i, total: videoFiles.length })
    }
  }

  return results
})