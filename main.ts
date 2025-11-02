// main.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// --- 配置 ---
// 从环境变量中读取配置
const WEBSIM_CHAT_API_URL = "https://websim.com/api/v1/inference/run_chat_completion";
const WEBSIM_IMAGE_API_URL = "https://websim.com/api/v1/inference/run_image_generation";

const WEBSIM_CHAT_PROJECT_ID = Deno.env.get("WEBSIM_CHAT_PROJECT_ID") || "8n26qj27l_9v7_8fxk9i";
const WEBSIM_IMAGE_PROJECT_ID = Deno.env.get("WEBSIM_IMAGE_PROJECT_ID") || "7s1bwhja5y2paq235t93";

// 用于保护你的服务的 API 密钥
const AUTHORIZATION_KEY = Deno.env.get("API_KEY");

// 模型映射表，现在包含了模型类型和对应的项目ID/API URL
// 这使得添加新模型变得非常容易
const MODEL_MAPPING = {
  "websim-chat": {
    type: "chat",
    projectId: WEBSIM_CHAT_PROJECT_ID,
    apiUrl: WEBSIM_CHAT_API_URL,
  },
  "websim-image": {
    type: "image",
    projectId: WEBSIM_IMAGE_PROJECT_ID,
    apiUrl: WEBSIM_IMAGE_API_URL,
  },
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
  
  // 验证 Authorization Header (可选但推荐)
  if (AUTHORIZATION_KEY) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${AUTHORIZATION_KEY}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }

  const { pathname } = new URL(req.url);

  // --- 路由 ---
  if (pathname === "/v1/models") {
    return handleModels();
  }
  if (pathname === "/v1/chat/completions") {
    return await handleChatCompletions(req);
  }
  if (pathname === "/v1/images/generations") {
    return await handleImageGeneration(req);
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
  try {
    const openaiRequest = await req.json();
    const modelConfig = MODEL_MAPPING[openaiRequest.model as keyof typeof MODEL_MAPPING];

    if (!modelConfig || modelConfig.type !== 'chat') {
      return new Response(JSON.stringify({ error: `Chat model not found: ${openaiRequest.model}` }), { status: 404 });
    }

    const websimPayload = {
      project_id: modelConfig.projectId,
      messages: openaiRequest.messages,
    };

    const apiResponse = await fetch(modelConfig.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(websimPayload),
    });

    if (!apiResponse.ok) throw new Error(`Upstream API error: ${apiResponse.status}`);
    const websimResponse = await apiResponse.json();

    const openaiResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: openaiRequest.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: websimResponse.content.trim() },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.error("Error in chat completions:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { status: 500 });
  }
}

// --- 图像生成路由的实现 ---
async function handleImageGeneration(req: Request): Promise<Response> {
  try {
    const openaiRequest = await req.json();
    const modelConfig = MODEL_MAPPING[openaiRequest.model as keyof typeof MODEL_MAPPING];

    if (!modelConfig || modelConfig.type !== 'image') {
      return new Response(JSON.stringify({ error: `Image model not found: ${openaiRequest.model}` }), { status: 404 });
    }

    // 将 OpenAI 的 size 参数转换为 websim 的 aspect_ratio
    // DALL-E 3 常用尺寸: 1024x1024, 1792x1024, 1024x1792
    let aspectRatio = "1:1"; // 默认值
    switch (openaiRequest.size) {
        case "1792x1024": aspectRatio = "16:9"; break;
        case "1024x1792": aspectRatio = "9:16"; break;
        case "1024x1024":
        default:
            aspectRatio = "1:1"; break;
    }

    const websimPayload = {
      project_id: modelConfig.projectId,
      prompt: openaiRequest.prompt,
      aspect_ratio: aspectRatio,
    };

    const apiResponse = await fetch(modelConfig.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(websimPayload),
    });

    if (!apiResponse.ok) throw new Error(`Upstream API error: ${apiResponse.status}`);
    const websimResponse = await apiResponse.json();

    const openaiResponse = {
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          url: websimResponse.url,
        },
      ],
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (error) {
    console.error("Error in image generation:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), { status: 500 });
  }
}

// --- 启动服务器 ---
serve(handler);
console.log(`Server running. Access it at http://localhost:8000`);

