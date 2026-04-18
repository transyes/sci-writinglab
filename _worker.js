// Cloudflare Pages Advanced Mode
// 根目录放 _worker.js 后，Pages 自动启用 Worker 模式，支持环境变量
// /api/proxy 路由处理 API 代理；其他路径透传给静态资源

const ALLOWED_ORIGINS = [
  "https://transyes.github.io",
  "https://sci-writinglab.pages.dev",
  "http://localhost",
  "http://127.0.0.1",
];

async function handleProxy(request, env) {
  const origin = request.headers.get("Origin") || "";
  // 同域请求不带 Origin，视为合法；跨域请求检查白名单
  const isAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  const corsOrigin = origin || "*";

  // CORS 预检
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": isAllowed ? corsOrigin : "",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!isAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": corsOrigin },
    });
  }

  // 限制 max_tokens 防止费用失控
  if (body.max_tokens && body.max_tokens > 4096) {
    body.max_tokens = 4096;
  }

  const isStreaming = body.stream === true;

  let upstream;
  try {
    upstream = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify(body),
      // 非流式加超时；流式不加（避免中途断流）
      ...(isStreaming ? {} : { signal: AbortSignal.timeout(25000) }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "上游连接失败: " + err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": corsOrigin },
    });
  }

  const contentType = upstream.headers.get("Content-Type") || "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/proxy 走代理逻辑
    if (url.pathname === "/api/proxy") {
      return handleProxy(request, env);
    }

    // 其他路径透传给 Pages 静态资源
    return env.ASSETS.fetch(request);
  },
};
