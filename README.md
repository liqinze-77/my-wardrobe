# 👗 我的衣柜 (My Wardrobe)

**在线体验（推荐，全功能，国内直连）**：https://liqinze-77.github.io/my-wardrobe/
**完整版镜像（自托管后端）**：https://www.modelscope.cn/studios/qz77qz/my-wardrobe
**开源仓库**：本仓库（欢迎 Star ⭐）

一个**本地优先**的韩系 ins 风格衣柜管理 + 虚拟试穿 Web 应用。拍照录入衣物、一键 AI 抠图、自由拖拽搭配，数据全部存在你自己的浏览器里，**不上传任何服务器、无需注册登录**。

> ✨ 支持 PWA，手机可「添加到主屏幕」像原生 App 一样使用；数据按浏览器隔离，分享链接给朋友也不会互相看到数据。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 📷 衣物录入 | 上传/拍照自动压缩，多维度打标签 |
| ✂️ 一键 AI 抠图 | rembg + u2net 模型推理，去除衣物背景 |
| 🏷️ 自定义标签 | 颜色（可多选）、季节、风格（可自定义添加/删除标签） |
| 🧺 位置标记 | 记录每件衣服放在哪个衣柜哪个位置 |
| 🎨 搭配画布 | 自由拖拽/缩放（支持移动端双指捏合）/分层，衣物随意叠搭 |
| 🧍 虚拟试穿 | 上传本人照片垫底 + 衣物叠加，看看穿上效果 |
| 💾 备份导出 | 一键导出/导入 JSON 备份（含自定义标签），换设备不丢数据 |
| 🌗 深色模式 | 跟随系统自动切换 |

## 🏗️ 架构

为了让国内用户**免登录、免下载、免翻墙**地使用全部功能（包括 AI 抠图），采用了三层零成本架构：

```
用户浏览器（IndexedDB 本地存储，数据不出设备）
    │
    ▼
GitHub Pages ── 前端静态托管（主入口，启动时探测可用后端）
    │  /api/rmbg（探测同源失败 → 自动回退远程代理）
    ▼
阿里云函数计算 FC ── 鉴权代理（Token 存于环境变量，不进代码仓库）
    │  注入 Authorization: Bearer
    ▼
魔搭创空间 Docker ── 推理后端（FastAPI + rembg/u2net ONNX）
```

**优雅降级设计**：前端启动时依次探测「同源后端 → 远程代理」，全部不可用时自动置灰抠图按钮，其余功能（录入/标签/搭配/试穿/备份）完全不受影响——同一份代码可跑在纯静态托管、函数计算、完整 Docker 三种环境。

### 为什么不直接调用推理后端？

1. 后端平台的网关只接受 `Authorization` 头鉴权，而浏览器跨域预检（OPTIONS）会被网关拒绝——跨域直调在浏览器侧不可行，必须服务端转发
2. 访问令牌不能写进公开的前端代码，放在 FC 环境变量里由代理注入，天然与开源仓库隔离
3. FC 国内直连、默认域名免备案，对用户完全无感

> 部署选型过程中实测了 Render（强制绑卡）、Hugging Face（国内不可达）、EdgeOne Pages（默认域名 3 小时限流）、Cloudflare Pages（大陆节点不支持动态计算）等方案，最终收敛为上述三层架构——详见下文「部署」。

## 🚀 快速开始

### 方式一：在线使用（推荐）

👉 https://liqinze-77.github.io/my-wardrobe/

打开即用，无需任何配置。所有数据存在本地浏览器，支持一键备份导出。

### 方式二：本地运行（开发者）

```bash
git clone https://github.com/liqinze-77/my-wardrobe.git
cd my-wardrobe
pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
# 打开 http://localhost:8000（同源后端，抠图走本地推理）
```

首次启动会自动下载抠图模型（约 170MB），之后离线可用。

### 方式三：Docker / 一键部署

仓库内已含 `Dockerfile` 与 `start.sh`（启动时自动从魔搭模型仓库拉取 u2net 模型），可直接部署到：

- **阿里魔搭创空间**：新建 Docker 类型创空间，上传本仓库全部文件即可（app_port: 7860）
- **Hugging Face Spaces**：同上，Docker 模板
- **任何支持 Docker 的平台**：`docker build -t my-wardrobe . && docker run -p 7860:7860 my-wardrobe`

### 方式四：复刻「静态前端 + 鉴权代理」三层架构

若你想把 AI 抠图代理部署在自己的函数计算上：

1. 前端部署到任意静态托管（GitHub Pages / Vercel / Netlify…）
2. 参照 [`aliyun-fc/`](aliyun-fc/)（阿里云函数计算）或 [`functions/`](functions/)（Cloudflare Pages）/ [`cloud-functions/`](cloud-functions/)（腾讯 EdgeOne）中的代理代码，配置环境变量 `MS_TOKEN` 并部署
3. 修改 `app.js` 中的 `REMOTE_RMBG_BASE` 为你的代理地址

## 📖 使用指南

1. **添加衣物**：进入「衣柜」页 → 右上角 ＋ → 填写颜色/季节/风格/存放位置，可多选颜色、自定义风格标签
2. **一键抠图**：上传衣物照片后点「✂️ 一键去背景」，AI 自动去背景
3. **筛选查找**：按颜色 / 季节 / 风格 / 关键词组合筛选
4. **搭配试穿**：切到「搭配」页 → 从衣物篮拖入衣服 → 上传本人照片垫底 → 拖拽/缩放调整 → 保存搭配
5. **添加到主屏幕**：iOS 用 Safari「添加到主屏幕」，Android 用 Chrome「安装应用」

## 🗄️ 数据与隐私

- 所有数据保存在浏览器 **IndexedDB**（`wardrobe-db`），不上传服务器
- 不同浏览器/设备数据相互独立，跨设备请使用「备份导出/导入」
- 抠图为无状态计算：照片仅用于即时推理，服务端不保存

## 🛠️ 技术栈

- **前端**：原生 HTML / CSS / JavaScript，无框架无构建，Canvas 2D 拖拽画布，IndexedDB 存储，PWA（Service Worker 自动更新）
- **后端**（可选）：FastAPI + rembg (u2net ONNX)
- **代理**：阿里云函数计算 / Cloudflare Pages Functions / EdgeOne Functions（多平台实现均已开源在仓库内）

## 📁 项目结构

```
my-wardrobe/
├── index.html          # 单页应用入口
├── app.js              # 全部业务逻辑（含后端探测与降级）
├── style.css           # 韩系 ins 风格样式
├── server.py           # FastAPI 后端（静态托管 + 抠图 API）
├── Dockerfile / start.sh   # Docker 部署（魔搭/HF 通用）
├── aliyun-fc/          # 阿里云函数计算代理（事件函数 / Web 函数两版）
├── functions/          # Cloudflare Pages Functions 代理
├── cloud-functions/    # 腾讯 EdgeOne Pages 代理
├── sw.js / manifest.webmanifest / icons/   # PWA
└── requirements.txt
```

## 📄 License

[MIT](LICENSE)
