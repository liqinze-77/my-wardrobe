// 衣柜应用 - 抠图 API 代理（阿里云函数计算 FC / Node.js Web 函数版）
// Token 存在 FC 控制台环境变量 MS_TOKEN 里
const http = require('http');
const TARGET = 'https://studio-qz77qz-my-wardrobe.api-inference.modelscope.net';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // 健康检查直接应答（不透传，避免依赖魔搭）
  if (url.pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, model: 'u2net', via: 'fc-proxy' }));
    return;
  }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = { 'Authorization': 'Bearer ' + (process.env.MS_TOKEN || '') };
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = ct;
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const resp = await fetch(TARGET + url.pathname + url.search, {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.writeHead(resp.status, {
      'content-type': resp.headers.get('content-type') || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});

server.listen(process.env.FC_SERVER_PORT || 9000);
