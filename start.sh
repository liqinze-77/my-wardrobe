#!/bin/bash
# 启动时预下载模型（优先用魔搭镜像源，失败则用官方源），再启动应用
mkdir -p /tmp/.u2net
python3 - <<'PY'
import os, urllib.request, sys
dest = '/tmp/.u2net/isnet-general-use.onnx'
if not os.path.exists(dest):
    urls = [
        'https://www.modelscope.cn/models/rembg/isnet-general-use/resolve/master/isnet-general-use.onnx',
        'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    ]
    for u in urls:
        try:
            print('downloading model from', u)
            urllib.request.urlretrieve(u, dest)
            print('model ok, size:', os.path.getsize(dest))
            break
        except Exception as e:
            print('failed:', e)
    else:
        sys.exit(1)
PY
exec uvicorn server:app --host 0.0.0.0 --port 7860
