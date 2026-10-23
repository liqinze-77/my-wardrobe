"""我的衣柜 · 本地服务
同时负责：
1. 托管静态页面（index.html 等）
2. /api/rmbg —— 一键抠图（rembg + isnet-general-use 本地模型，图片不出本机）
"""
import io
import os
import threading

from fastapi import FastAPI, File, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL = "u2net"
MAX_SIDE = 1400  # 送入模型前限制最长边，保证速度

_session = None
_lock = threading.Lock()


def get_session():
    global _session
    with _lock:
        if _session is None:
            from rembg import new_session
            _session = new_session(MODEL)
    return _session


def _warmup():
    """启动后台预热模型，避免第一次请求等太久"""
    try:
        get_session()
        print("[rmbg] 模型预热完成")
    except Exception as e:  # noqa: BLE001
        print("[rmbg] 模型预热失败:", e)


app = FastAPI(title="wardrobe-api")

# 允许跨域调用（GitHub Pages 等静态前端可远程使用本抠图服务）
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    threading.Thread(target=_warmup, daemon=True).start()


def _trim_transparent(img: Image.Image, pad: int = 4) -> Image.Image:
    """裁掉四周的透明边，让贴纸紧凑（留一点 padding）"""
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(img.width, r + pad); b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/api/rmbg")
def rmbg(file: UploadFile = File(...)):
    try:
        data = file.file.read()
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGBA")
        # 限尺寸
        if max(img.size) > MAX_SIDE:
            ratio = MAX_SIDE / max(img.size)
            img = img.resize((round(img.width * ratio), round(img.height * ratio)), Image.LANCZOS)
        from rembg import remove
        out = remove(img, session=get_session())
        out = _trim_transparent(out)
        buf = io.BytesIO()
        out.save(buf, "WEBP", quality=88, method=4)
        return Response(
            content=buf.getvalue(),
            media_type="image/webp",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as e:  # noqa: BLE001
        return Response(
            content=f'{{"error":"{type(e).__name__}"}}'.encode(),
            status_code=500,
            media_type="application/json",
        )


# 静态文件放在最后，避免吃掉 /api 路由
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
