# Video Watermark Tool (批量视频添加水印工具)

一个基于 Electron 开发的跨平台视频处理软件，为多个视频文件批量添加水印。

![](screenshot.png)

## 功能

**批量并行处理**：支持一次性导入多个视频文件，并自动完成排队处理。

**智能选色**：内置图像亮度分析算法，可根据视频背景自动切换黑/白水印颜色，确保水印清晰可见。

**自定义参数**：支持自定义文字内容、字体大小、透明度以及水印位置（四角可选）。

**实时显示进度**：基于 IPC 通信机制，前端实时更新每个文件的处理百分比及完成状态。

## 技术栈
**Runtime**: Electron (v39.0+)

**Processing**: FFmpeg (via fluent-ffmpeg, ffmpeg-static)

**Image Logic**: Sharp (用于颜色分析) & @napi-rs/canvas (用于水印图层绘制)

**UI**: HTML5, CSS3, Vanilla JavaScript

## 安装与运行
1. 克隆仓库

```bash
git clone https://github.com/dev-coco/Video-Watermark.git

# 进入对应目录
cd Video-Watermark/macOS
cd Video-Watermark/Windows
```

2. 安装依赖

```bash
npm install
```

3. 字体配置

由于项目使用了 Canvas 绘制文字，请确保在 `fonts` 目录下放置以下字体文件（或修改 `main.js` 中的路径）：
- NotoSans.ttf
- NotoSerifCJK.ttf

4. 启动应用

```bash
npm start
```

5. 打包构建

```bash
# 构建适用于当前系统的包
npm run build

# 构建 macOS 特定版本
npm run dist
```
