// Cloudflare Pages Function：API 代理
// 路径：functions/api/proxy.js → 访问地址：/api/proxy
// 与 Worker 逻辑相同，但部署在 pages.dev 域名下，国内可直接访问

export async function onRequest(context) {
  const { request, env } = context;

  // ─── CORS：只允许你的网站调用 ───
  const ALLOWED_ORIGINS = [
    "https://transyes.github.io",
    "https://sci-writinglab.pages.dev",
    "http://localhost",
    "http://127.0.0.1",
  ];

  const origin = request.headers.get("Origin") || "";
  // 同域请求不带 Origin 头，视为合法；跨域请求检查白名单
  const isAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  const corsOrigin = origin || "*";

  // 预检请求（CORS preflight）
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

  // ─── 解析请求体 ───
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin },
    });
  }

  // 安全：限制 max_tokens，防止费用失控
  if (body.max_tokens && body.max_tokens > 4096) {
    body.max_tokens = 4096;
  }

  // ─── 转发到 DeepSeek ───
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
      // 非流式请求加 25s 超时；流式请求不加（避免中途断流）
      ...(isStreaming ? {} : { signal: AbortSignal.timeout(25000) }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "上游连接失败: " + err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin },
    });
  }

  // ─── 流式透传响应体 ───
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
