// 衣柜应用 - Cloudflare Worker 入口
// 静态资源由 assets 托管；/api/* 转发到魔搭并注入 Token
const TARGET = 'https://studio-qz77qz-my-wardrobe.api-inference.modelscope.net';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const headers = { 'Authorization': 'Bearer ' + (env.MS_TOKEN || '') };
      const ct = request.headers.get('content-type');
      if (ct) headers['Content-Type'] = ct; // multipart 表单解析必需
      let body;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
      }
      const resp = await fetch(TARGET + url.pathname + url.search, {
        method: request.method, headers, body,
      });
      const h = new Headers();
      const rct = resp.headers.get('content-type');
      if (rct) h.set('content-type', rct);
      h.set('access-control-allow-origin', '*'); // 供 GitHub Pages 镜像跨域调用
      return new Response(resp.body, { status: resp.status, headers: h });
    }
    return env.ASSETS.fetch(request); // 其余请求走静态文件
  },
};
