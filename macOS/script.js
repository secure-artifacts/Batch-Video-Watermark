let selectedVideos = []
let selectedPosition = 'bottom-right'
let isProcessing = false

const fileSelector = document.querySelector('.file-selector')
const fileList = document.getElementById('fileList')
const processButton = document.getElementById('processButton')
const opacityRange = document.getElementById('watermarkOpacity')
const opacityValue = document.getElementById('opacityValue')
const positionOptions = document.querySelectorAll('.position-option')
const smartColorCheckbox = document.getElementById('smartColor')
const watermarkColorInput = document.getElementById('watermarkColor')
const colorValue = document.getElementById('colorValue')

/**
 * @description 滚动到指定文件项，使其在文件列表中可见（居中显示）
 * @param {number} index - 文件在列表中的索引
 */
function scrollToFileItem (index) {
  setTimeout(() => {
    const fileItem = document.getElementById(`file-${index}`)
    if (fileItem) {
      // 滚动到该文件项，使其显示在列表中间
      fileItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest' // 不完全滚动到顶部，只是确保可见
      })
    }
  }, 0)
}

fileSelector.addEventListener('click', async () => {
  try {
    const filePaths = await window.electronAPI.selectVideos()
    if (filePaths && filePaths.length > 0) {
      selectedVideos = filePaths.map(filepath => {
        const pathParts = filepath.split(/[\/\\]/)
        const name = pathParts[pathParts.length - 1]
        return {
          name: name,
          path: filepath,
          status: 'pending'
        }
      })
      updateFileList()
      checkProcessButton()
      console.log('✓ 已选择', selectedVideos.length, '个文件')
    }
  } catch (error) {
    console.error('选择文件出错:', error)
    alert('选择文件时出错')
  }
})

positionOptions.forEach(option => {
  option.addEventListener('click', () => {
    positionOptions.forEach(opt => opt.classList.remove('selected'))
    option.classList.add('selected')
    selectedPosition = option.dataset.position
    console.log('选择的水印位置:', selectedPosition)
  })
})

smartColorCheckbox.addEventListener('change', e => {
  if (e.target.checked) {
    watermarkColorInput.disabled = true
  } else {
    watermarkColorInput.disabled = false
  }
})

watermarkColorInput.addEventListener('input', e => {
  colorValue.textContent = e.target.value.toUpperCase()
})

opacityRange.addEventListener('input', e => {
  opacityValue.textContent = `${e.target.value}%`
})

// 更新文件列表的 DOM 显示内容，根据 selectedVideos 渲染每个视频项
function updateFileList () {
  fileList.innerHTML = ''
  selectedVideos.forEach((video, index) => {
    const div = document.createElement('div')
    div.className = 'file-item'
    div.id = `file-${index}`
    div.innerHTML = `
        <div class="file-item-left">
          <div class="file-item-name">📹 ${video.name}</div>
          <div class="progress-bar" id="progress-bar-${index}">
            <div class="progress-fill" style="width: 0%"></div>
          </div>
        </div>
        <div class="file-item-status" id="status-${index}">待处理</div>
      `
    fileList.appendChild(div)
  })
}

function checkProcessButton () {
  processButton.disabled = selectedVideos.length === 0 || isProcessing
}

// 处理视频加水印任务
processButton.addEventListener('click', async () => {
  try {
    const watermarkText = document.getElementById('watermarkText').value
    const fontSize = parseInt(document.getElementById('fontSize').value)
    const watermarkColor = document.getElementById('watermarkColor').value
    const opacity = parseInt(document.getElementById('watermarkOpacity').value) / 100

    const enableSmartColor = smartColorCheckbox.checked === true

    if (!watermarkText) {
      alert('请填写水印文字')
      return
    }

    if (selectedVideos.length === 0) {
      alert('请先选择视频文件')
      return
    }

    isProcessing = true
    processButton.disabled = true

    selectedVideos.forEach((video, index) => {
      const statusEl = document.getElementById(`status-${index}`)
      const progressBar = document.getElementById(`progress-bar-${index}`)
      statusEl.textContent = '处理中'
      statusEl.className = 'file-item-status processing'
      progressBar.classList.add('show')
    })

    const videoPaths = selectedVideos.map(v => v.path)

    const results = await window.electronAPI.processVideos({
      videoFiles: videoPaths,
      watermarkText,
      fontSize,
      watermarkColor,
      opacity,
      position: selectedPosition,
      enableSmartColor: enableSmartColor
    })

    console.log('✓ 所有视频处理完成')
  } catch (error) {
    console.error('处理视频出错:', error)
    alert('处理失败: ' + error.message)
  } finally {
    isProcessing = false
    processButton.disabled = false
  }
})

// 监听来自主进程的处理进度事件，实时更新进度条并滚动到对应文件项
window.electronAPI.onProcessingProgress((event, data) => {
  const progressBar = document.getElementById(`progress-bar-${data.index}`)
  if (progressBar) {
    progressBar.querySelector('.progress-fill').style.width = `${data.progress}%`
    // 每次进度更新时滚动到当前处理的文件项
    scrollToFileItem(data.index)
  }
})

// 监听视频处理完成事件，更新文件状态显示（完成/失败）并滚动到最新完成项
window.electronAPI.onFileCompleted((event, data) => {
  const statusEl = document.getElementById(`status-${data.index}`)
  const progressBar = document.getElementById(`progress-bar-${data.index}`)

  if (statusEl && progressBar) {
    progressBar.querySelector('.progress-fill').style.width = '100%'

    if (data.status === 'success') {
      statusEl.textContent = '✓ 完成'
      statusEl.className = 'file-item-status completed'
    } else {
      console.log('data', data)
      console.log('event', event)
      statusEl.textContent = '✗ 失败'
      statusEl.className = 'file-item-status failed'
    }
  }

  // 文件完成后滚动到该文件项
  scrollToFileItem(data.index)
})
