const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  analyzeVideoColor: (videoPath, position = 'bottom-right') => ipcRenderer.invoke('analyze-video-color', { videoPath, position }),
  processVideos: options => ipcRenderer.invoke('process-videos', options),
  onProcessingStatus: callback => ipcRenderer.on('processing-status', callback),
  onProcessingProgress: callback => ipcRenderer.on('processing-progress', callback),
  onFileCompleted: callback => ipcRenderer.on('file-completed', callback),
  onColorAnalyzed: callback => ipcRenderer.on('color-analyzed', callback)
})

console.log('✅ preload.js 已加载')
