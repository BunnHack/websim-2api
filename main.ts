// main.ts (v2 - with CORS and Streaming support)
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// --- 配置 ---
const WEBSIM_API_URL = "https://websim.com/api/v1/inference/run_chat_completion";
const WEBSIM_PROJECT_ID = Deno.env.get("WEBSIM_PROJECT_ID") || "8n26qj27l_9v7_8fxk9i";
const AUTHORIZATION_KEY = Deno.env.get("API_KEY");

const MODEL_MAPPING = {
  "websim-chat": WEBSIM_PROJECT_ID,
};

// --- 主处理函数 ---
async function handler(req: Request): Promise<Response> {
  // 1. 更健壮的 CORS 预检请求处理
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
  
  // 添加通用的 CORS 头
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
  };

  const { pathname } = new URL(req.url);

  try {
    if (pathname === "/v1/models") {
      return handleModels(corsHeaders);
    }

    if (pathname === "/v1/chat/completions") {
      return await handleChatCompletions(req, corsHeaders);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error("Internal Server Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// --- 模型路由实现 ---
function handleModels(headers: Record<string, string>): Response {
  const models = Object.keys(MODEL_MAPPING).map(modelId => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "user",
  }));

  const responseData = { object: "list", data: models };
  
  return new Response(JSON.stringify(responseData), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// --- 聊天路由实现 (核心升级) ---
async function handleChatCompletions(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  console.log(`[${new Date().toISOString()}] Received chat completion request.`);

  // 验证 Authorization
  if (AUTHORIZATION_KEY) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${AUTHORIZATION_KEY}`) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }
  }

  let openaiRequest;
  try {
    openaiRequest = await req.json();
    console.log("Request Body:", JSON.stringify(openaiRequest, null, 2));
  } catch (e) {
    return new Response("Invalid JSON body", { status: 400, headers: corsHeaders });
  }
  
  const modelId = openaiRequest.model;
  const projectId = MODEL_MAPPING[modelId as keyof typeof MODEL_MAPPING];

  if (!projectId) {
    return new Response(JSON.stringify({ error: `Model not found: ${modelId}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const websimPayload = {
    project_id: projectId,
    messages: openaiRequest.messages,
  };

  // 调用 websim.com API
  const apiResponse = await fetch(WEBSIM_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(websimPayload),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text();
    console.error("Upstream API error:", errorBody);
    return new Response(`Upstream API error: ${apiResponse.statusText}`, { status: apiResponse.status, headers: corsHeaders });
  }

  const websimResponse = await apiResponse.json();
  const content = websimResponse.content?.trim() ?? "";

  const isStreaming = openaiRequest.stream === true;

  // 2. 根据客户端是否要求 stream，返回不同格式的响应
  if (isStreaming) {
    console.log("Streaming response requested. Emulating SSE stream.");
    // 模拟流式响应 (SSE - Server-Sent Events)
    const stream = new ReadableStream({
      start(controller) {
        const chunkId = `chatcmpl-${crypto.randomUUID()}`;
        
        // 模拟 OpenAI 的流式块
        const streamChunk = {
          id: chunkId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: { content: content },
            finish_reason: null,
          }],
        };
        
        // 结束块
        const finalChunk = {
          id: chunkId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
        };
        
        // 发送数据块
        controller.enqueue(`data: ${JSON.stringify(streamChunk)}\n\n`);
        // 发送结束块
        controller.enqueue(`data: ${JSON.stringify(finalChunk)}\n\n`);
        // 发送终止信号
        controller.enqueue(`data: [DONE]\n\n`);
        
        controller.close();
      },
    });
    
    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } else {
    console.log("Non-streaming response requested.");
    // 返回标准的一次性 JSON 响应
    const openaiResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: { role: "assistant", content: content },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    };
    
    return new Response(JSON.stringify(openaiResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// --- 启动服务器 ---
serve(handler);
console.log(`Server running. Access it at http://localhost:8000`);
