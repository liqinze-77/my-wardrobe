# 👗 我的衣柜 (My Wardrobe)

一个**纯本地运行**的韩系 ins 风格衣柜管理 + 虚拟试穿 Web 应用。拍照录入衣物、一键 AI 抠图、自由拖拽搭配，数据全部存在你自己的浏览器里，**不上传任何服务器、无需注册登录**。

> ✨ 支持 PWA，手机可「添加到主屏幕」像原生 App 一样使用；数据按浏览器隔离，分享链接给朋友也不会互相看到数据。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 📷 衣物录入 | 上传/拍照自动压缩，多维度打标签 |
| ✂️ 一键 AI 抠图 | rembg + isnet 模型本地推理，去除衣物背景 |
| 🏷️ 自定义标签 | 颜色（可多选）、季节、风格（可自定义添加/删除标签） |
| 🧺 位置标记 | 记录每件衣服放在哪个衣柜哪个位置 |
| 🎨 搭配画布 | 自由拖拽/缩放/分层，衣物随意叠搭 |
| 🧍 虚拟试穿 | 上传本人照片垫底 + 衣物叠加，看看穿上效果 |
| 💾 备份导出 | 一键导出/导入 JSON 备份（含自定义标签），换设备不丢数据 |
| 🌗 深色模式 | 跟随系统自动切换 |

## 🚀 快速开始

### 方式一：在线使用（静态版）

直接部署到任意静态托管（GitHub Pages / Vercel / Netlify 等）即可使用**除 AI 抠图外**的全部功能 —— 页面会自动探测后端并优雅降级。

### 方式二：完整版（含 AI 抠图，推荐）

```bash
git clone <your-repo-url>
cd my-wardrobe
pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
# 打开 http://localhost:8000
```

首次运行会自动下载抠图模型（约 170MB），之后离线可用。

### 一键部署（Render）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

也可以部署到 Railway / Fly.io 等任何支持 Python 的平台，启动命令同上。

## 📖 使用指南

1. **添加衣物**：进入「衣柜」页 → 右下角 ＋ → 填写颜色/季节/风格/存放位置，可多选颜色、自定义风格标签
2. **一键抠图**：上传衣物照片后点「✂️ 一键抠图」，AI 自动去背景
3. **筛选查找**：按颜色 / 季节 / 风格 / 关键词组合筛选
4. **搭配试穿**：切到「搭配」页 → 从衣物篮拖入衣服 → 点 🧍 上传本人照片垫底 → 拖拽调整位置大小 → 保存搭配
5. **添加到主屏幕**：iOS 用 Safari「添加到主屏幕」，Android 用 Chrome「安装应用」

## 🗄️ 数据存储

- 所有数据保存在浏览器 **IndexedDB**（`wardrobe-db`），不上传服务器
- 不同浏览器/设备数据相互独立，跨设备请使用「备份导出/导入」

## 🛠️ 技术栈

- **前端**：原生 HTML / CSS / JavaScript，无框架无构建，Canvas 2D 拖拽画布，IndexedDB 存储，PWA
- **后端**（可选）：FastAPI + rembg (isnet-general-use ONNX)
- **抠图模型**：[isnet-general-use](https://github.com/xuebinqin/DIS) 本地 ONNX 推理

## 📁 项目结构

```
my-wardrobe/
├── index.html          # 单页应用入口
├── app.js              # 全部业务逻辑
├── style.css           # 韩系 ins 风格样式
├── server.py           # FastAPI 后端（静态托管 + 抠图 API）
├── sw.js / manifest.webmanifest / icons/   # PWA
└── requirements.txt
```

## 📄 License

[MIT](LICENSE)
