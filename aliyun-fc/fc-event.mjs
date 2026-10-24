// 衣柜应用 - 抠图 API 代理（阿里云 FC 事件函数 + HTTP 触发器版）
// Token 存在 FC 控制台环境变量 MS_TOKEN 里
const TARGET = 'https://studio-qz77qz-my-wardrobe.api-inference.modelscope.net';

export const handler = async (event) => {
  const evt = JSON.parse(Buffer.from(event).toString('utf8'));
  const path = evt.rawPath || evt.path || '/';          // 兼容新旧触发器字段名
  const method = evt.httpMethod || (evt.requestContext && evt.requestContext.http && evt.requestContext.http.method) || 'GET';
  const qs = evt.queryParameters ? new URLSearchParams(evt.queryParameters).toString() : '';
  const rawHeaders = evt.headers || {};
  const ct = rawHeaders['content-type'] || rawHeaders['Content-Type'];

  const json = (status, obj) => ({
    isBase64Encoded: false,
    statusCode: status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(obj),
  });

  try {
    if (path === '/api/health' && method === 'GET') {
      return json(200, { ok: true, model: 'u2net', via: 'fc-proxy' });
    }
    const headers = { 'Authorization': 'Bearer ' + (process.env.MS_TOKEN || '') };
    if (ct) headers['Content-Type'] = ct; // multipart 表单解析必需
    let body;
    if (!['GET', 'HEAD'].includes(method) && evt.body) {
      body = evt.isBase64Encoded ? Buffer.from(evt.body, 'base64') : Buffer.from(evt.body);
    }
    const resp = await fetch(TARGET + path + (qs ? '?' + qs : ''), { method, headers, body });
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      isBase64Encoded: true,
      statusCode: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') || 'application/octet-stream',
        'access-control-allow-origin': '*',
      },
      body: buf.toString('base64'),
    };
  } catch (e) {
    return json(502, { ok: false, error: String(e), cause: String(e && e.cause || ''), stage: 'proxy-fetch' });
  }
};
