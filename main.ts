// main.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { cors } from "https://deno.land/x/hono@v3.12.9/middleware/cors/index.ts";

// --- 配置 ---
// 从环境变量中读取配置，这是在 Deno Deploy 上设置的
const WEBSIM_API_URL = "https://websim.com/api/v1/inference/run_chat_completion";
const WEBSIM_PROJECT_ID = Deno.env.get("WEBSIM_PROJECT_ID") || "8n26qj27l_9v7_8fxk9i";
const AUTHORIZATION_KEY = Deno.env.get("API_KEY"); // 用于保护你的服务

// 定义一个模型名称与 Project ID 的映射
// 客户端将使用 "websim-chat" 作为 model 参数
const MODEL_MAPPING = {
  "websim-chat": WEBSIM_PROJECT_ID,
  // 如果你有多个项目，可以在这里添加更多映射
  // "another-model": "another_project_id"
};

// --- 主处理函数 ---
async function handler(req: Request): Promise<Response> {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const { pathname } = new URL(req.url);

  // --- 路由 1: /v1/models ---
  // 客户端通过这个接口获取可用的模型列表
  if (pathname === "/v1/models") {
    return handleModels();
  }

  // --- 路由 2: /v1/chat/completions ---
  // 核心的聊天接口
  if (pathname === "/v1/chat/completions") {
    return await handleChatCompletions(req);
  }

  return new Response("Not Found", { status: 404 });
}

// --- 模型路由的实现 ---
function handleModels(): Response {
  const models = Object.keys(MODEL_MAPPING).map(modelId => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "user",
  }));

  const responseData = {
    object: "list",
    data: models,
  };
  
  return new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json" },
  });
}

// --- 聊天路由的实现 ---
async function handleChatCompletions(req: Request): Promise<Response> {
  // 1. 验证 Authorization Header (可选但推荐)
  if (AUTHORIZATION_KEY) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${AUTHORIZATION_KEY}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 2. 解析 OpenAI 格式的请求体
  let openaiRequest;
  try {
    openaiRequest = await req.json();
  } catch (e) {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const modelId = openaiRequest.model;
  const projectId = MODEL_MAPPING[modelId as keyof typeof MODEL_MAPPING];

  if (!projectId) {
    return new Response(JSON.stringify({ error: `Model not found: ${modelId}` }), { status: 404 });
  }

  // 3. 将请求转换为 websim.com 格式
  const websimPayload = {
    project_id: projectId,
    messages: openaiRequest.messages,
    // 注意: websim.com API 不支持 stream, temperature 等参数，所以我们忽略它们
  };

  try {
    // 4. 调用 websim.com API
    const apiResponse = await fetch(WEBSIM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 如果 websim.com 需要其他认证头，请在这里添加
        // "Authorization": `Bearer ${Deno.env.get("WEBSIM_API_KEY")}`
      },
      body: JSON.stringify(websimPayload),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error("Upstream API error:", errorBody);
      return new Response(`Upstream API error: ${apiResponse.statusText}`, { status: apiResponse.status });
    }

    const websimResponse = await apiResponse.json();

    // 5. 将 websim.com 的响应转换为 OpenAI 格式
    const openaiResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: websimResponse.content.trim(), // 清理可能存在的前后空格/换行
          },
          finish_reason: "stop",
        },
      ],
      usage: { // websim API 没有返回 token 数量，我们填充 null 或 0
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
      },
    };

    // 6. 返回 OpenAI 格式的响应
    return new Response(JSON.stringify(openaiResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // 添加CORS头，方便前端直接调用
      },
    });

  } catch (error) {
    console.error("Error processing request:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// --- 启动服务器 ---
serve(handler);

console.log(`Server running. Access it at http://localhost:8000`);
