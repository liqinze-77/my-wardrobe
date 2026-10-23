// 衣柜应用 - 抠图 API 代理
// 浏览器 -> 本函数(同源,无跨域问题) -> 魔搭 API(注入 Token)
// Token 存在 EdgeOne Pages 控制台的环境变量 MS_TOKEN 里,不进代码仓库
const TARGET = 'https://studio-qz77qz-my-wardrobe.api-inference.modelscope.net';

export default async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const path = url.pathname; // 保留完整路径：网关要求 /api/health 这种形式
  const method = req.method;

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  const headers = { 'Authorization': 'Bearer ' + (context.env && context.env.MS_TOKEN || '') };
  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct; // 必须透传，multipart 表单解析依赖它
  try {
    const resp = await fetch(TARGET + path + url.search, {
      method,
      headers,
      body,
    });
    const headers = new Headers();
    const ct = resp.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    headers.set('access-control-allow-origin', '*'); // 供 GitHub Pages 镜像跨域调用
    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
}
