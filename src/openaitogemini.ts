// Removed Deno std import for base64
import {
    generateSdxContent,
    generateSdxContentStream,
    embedSdxContent,
    listSdxModels, // Added for model listing
    GenerateSdxContentParams,
    EmbedSdxContentParams,
    SdkConfigOptions,
    // Import re-exported types from geminiapi.ts
    Content,
    Part,
    EmbedContentResponse,
    HarmCategory,
    HarmBlockThreshold,
    FunctionCallingConfigMode,
    Model as SdkModel, // For typing models from listSdxModels
    RestListModelsResponse, // For typing the response from listSdxModels
} from "./geminiapi.ts";

// --- Interfaces for OpenAI-style requests (simplified) ---
interface OpenAIChatCompletionRequest {
    model: string;
    messages: { role: string; content: any }[];
    stream?: boolean;
    stream_options?: { include_usage?: boolean };
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    n?: number;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    response_format?: { type: string };
    tools?: any[];
    tool_choice?: any;
}

interface OpenAIEmbeddingRequest {
    model: string;
    input: string | string[];
    dimensions?: number;
}

interface OpenAIUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

interface GeminiCandidate {
  content?: Content; // Content is already imported
  finishReason?: string;
  // Allow other properties that might exist on a candidate
  [key: string]: any;
}

// --- Transformation Logic (Adapted from old worker.mjs) ---

const defaultSafetySettings: Array<{category: HarmCategory; threshold: HarmBlockThreshold}> = [
  { category: "HARM_CATEGORY_HATE_SPEECH" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_HARASSMENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
];

const fieldsMap: { [key: string]: string } = {
  stop: "stopSequences",
  n: "candidateCount",
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  top_k: "topK",
};

const transformOpenAIConfigToSdkConfigOptions = (req: OpenAIChatCompletionRequest): SdkConfigOptions => {
  const sdkConfig: SdkConfigOptions = {};

  for (const key in req) {
    if (key === "model" || key === "messages" || key === "stream" || key === "stream_options" || key === "tools" || key === "tool_choice") continue;

    const matchedKey = fieldsMap[key as keyof typeof fieldsMap];
    if (matchedKey) {
      if (matchedKey === "stopSequences" && req.stop != null) {
        if (typeof req.stop === 'string') {
          sdkConfig[matchedKey as "stopSequences"] = [req.stop];
        } else if (Array.isArray(req.stop)) {
          sdkConfig[matchedKey as "stopSequences"] = req.stop.filter(s => typeof s === 'string');
        }
      } else if (req[key as keyof OpenAIChatCompletionRequest] !== undefined) {
        (sdkConfig as any)[matchedKey] = req[key as keyof OpenAIChatCompletionRequest];
      }
    } else if (key === "temperature" || key === "max_tokens" || key === "top_p" || key === "top_k" || key === "n") {
        if (key === "max_tokens" && req.max_tokens !== undefined) sdkConfig.maxOutputTokens = req.max_tokens;
        else if (key === "n" && req.n !== undefined) sdkConfig.candidateCount = req.n;
        else if (req[key as keyof OpenAIChatCompletionRequest] !== undefined) {
            (sdkConfig as any)[key] = req[key as keyof OpenAIChatCompletionRequest];
        }
    }
  }

  if (req.response_format?.type === "json_object") {
    sdkConfig.responseMimeType = "application/json";
  }
  sdkConfig.safetySettings = defaultSafetySettings; // Enforced OFF
  return sdkConfig;
};

async function parseImgData(url: string): Promise<Part> {
  let mimeType, data;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    mimeType = response.headers.get("content-type") || "application/octet-stream";
    const imageBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);
    let binaryString = '';
    uint8Array.forEach((byte) => {
      binaryString += String.fromCharCode(byte);
    });
    data = btoa(binaryString);
  } else if (url.startsWith("data:")) {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match?.groups) throw new Error("Invalid image data URI");
    mimeType = match.groups.mimeType;
    data = match.groups.data;
  } else {
    throw new Error("Unsupported image URL format");
  }
  return { inlineData: { mimeType, data } };
}

async function transformOpenAIMessagesToGeminiContents(
    messages: { role: string; content: any }[]
): Promise<{ contents: Content[], systemInstruction?: Content }> {
    const geminiContents: Content[] = [];
    let systemInstruction: Content | undefined = undefined;

    for (const msg of messages) {
        const parts: Part[] = [];
        if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
                if (item.type === "text") {
                    parts.push({ text: item.text });
                } else if (item.type === "image_url" && item.image_url?.url) {
                    try {
                        parts.push(await parseImgData(item.image_url.url));
                    } catch (e) {
                        console.warn(`Failed to parse image URL ${item.image_url.url}: ${(e as Error).message}`);
                        parts.push({text: `[Image URL could not be processed: ${item.image_url.url}]` });
                    }
                }
            }
        }
        if (msg.role === "system") {
            if (parts.length > 0) {
                 systemInstruction = { role: "system", parts };
            }
        } else {
            geminiContents.push({
                role: msg.role === "assistant" ? "model" : "user",
                parts,
            });
        }
    }
    return { contents: geminiContents, systemInstruction };
}

const generateOpenAIId = (prefix = "chatcmpl-") => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return prefix + Array.from({ length: 29 }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
};

const geminiFinishReasonToOpenAI = (
    reason?: string | null,
    geminiCandidate?: GeminiCandidate
): string | null => {
    if (!reason) return null;
    if (geminiCandidate?.content?.parts?.some((p: Part) => p.functionCall)) {
        return "tool_calls";
    }
    const map: { [key: string]: string } = {
        "STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter",
        "RECITATION": "content_filter", "OTHER": "stop", "UNKNOWN": "stop",
        "MODEL_UNSPECIFIED_FINISH_REASON": "stop", "FINISH_REASON_UNSPECIFIED": "stop",
        "FUNCTION_CALL": "tool_calls", // Should be covered by the check above, but as fallback
    };
    return map[reason.toUpperCase()] || reason.toLowerCase();
};

function transformGeminiCandidateToOpenAIChoice(
    candidate: GeminiCandidate, index: number = 0, isStream: boolean = false
) {
    const messageOrDeltaKey = isStream ? "delta" : "message";
    const outputPart: any = { role: "assistant", content: null };
    let textContent = "";
    let functionCalls: any[] | undefined = undefined;

    if (candidate.content?.parts) {
        candidate.content.parts.forEach((part: Part) => {
            if (part.text) textContent += part.text;
            if (part.functionCall) {
                if (!functionCalls) functionCalls = [];
                functionCalls.push({
                    id: `call_${generateOpenAIId("fcid-")}`, type: "function", function: part.functionCall,
                });
            }
        });
    }
    if (textContent) outputPart.content = textContent;
    if (functionCalls) outputPart.tool_calls = functionCalls;

    return { index: index, [messageOrDeltaKey]: outputPart, logprobs: null,
        finish_reason: geminiFinishReasonToOpenAI(candidate.finishReason, candidate),
    };
}

function transformGeminiUsageToOpenAI(usageMetadata: any): OpenAIUsage {
    if (!usageMetadata) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return {
        prompt_tokens: usageMetadata.promptTokenCount || 0,
        completion_tokens: usageMetadata.candidatesTokenCount || 0,
        total_tokens: usageMetadata.totalTokenCount || 0,
    };
}

export async function handleOpenAIChatCompletion(
    apiKey: string, openAIRequest: OpenAIChatCompletionRequest
): Promise<Response> {
    const { contents: geminiContents, systemInstruction } = await transformOpenAIMessagesToGeminiContents(openAIRequest.messages);
    const sdkConfigOptions = transformOpenAIConfigToSdkConfigOptions(openAIRequest);
    if (systemInstruction) sdkConfigOptions.systemInstruction = systemInstruction;

    if (openAIRequest.tools) {
        sdkConfigOptions.tools = openAIRequest.tools.map(tool =>
            tool.type === "function" && tool.function ? { functionDeclarations: [tool.function] } : tool
        );
    }
    if (openAIRequest.tool_choice) {
        if (typeof openAIRequest.tool_choice === 'string') {
            const choiceStr = openAIRequest.tool_choice.toUpperCase();
            if (choiceStr === "AUTO" && "AUTO" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }};
            } else if (choiceStr === "ANY" && "ANY" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY }};
            } else if (choiceStr === "NONE" && "NONE" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE }};
            }
        } else if (typeof openAIRequest.tool_choice === 'object' && openAIRequest.tool_choice.type === 'function' && openAIRequest.tool_choice.function) {
             sdkConfigOptions.toolConfig = {
                functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [openAIRequest.tool_choice.function.name] }
            };
        }
    }

    const geminiParams: GenerateSdxContentParams = {
        model: openAIRequest.model, contents: geminiContents, config: sdkConfigOptions,
    };
    const id = generateOpenAIId();

    if (openAIRequest.stream) {
        try {
            const geminiStream = await generateSdxContentStream(apiKey, geminiParams);
            const readableStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    for await (const chunk of geminiStream) {
                        if (chunk.candidates && chunk.candidates.length > 0) {
                            const choice = transformGeminiCandidateToOpenAIChoice(chunk.candidates[0], 0, true);
                            const openAIStreamChunk: {id: string; object: string; created: number; model: string; choices: any[]; usage: OpenAIUsage | null} = {
                                id: id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
                                model: openAIRequest.model, choices: [choice], usage: null,
                            };
                            // Always include usage in the final chunk if available from Gemini
                            if (choice.finish_reason && chunk.usageMetadata) { 
                                openAIStreamChunk.usage = transformGeminiUsageToOpenAI(chunk.usageMetadata);
                            }
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIStreamChunk)}\n\n`));
                        } else if (chunk.promptFeedback) console.warn("Gemini stream prompt feedback:", chunk.promptFeedback);
                    }
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                }
            });
            return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }});
        } catch (error) {
            console.error("Error during Gemini stream generation:", error);
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Stream failed", type: "gemini_error" }}), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
    } else {
    try {
            const geminiResult = await generateSdxContent(apiKey, geminiParams);
            const choices = geminiResult.candidates?.map((cand: GeminiCandidate, idx: number) => transformGeminiCandidateToOpenAIChoice(cand, idx, false)) || [];
            const openAIResponse = {
                id: id, object: "chat.completion", created: Math.floor(Date.now() / 1000),
                model: openAIRequest.model, choices: choices, usage: transformGeminiUsageToOpenAI(geminiResult.usageMetadata),
            };
            return new Response(JSON.stringify(openAIResponse), { headers: { 'Content-Type': 'application/json; charset=utf-8' }});
        } catch (error) {
            const status = (error as any)?.status ?? 500;
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Request failed", type: (error as any)?.name || "gemini_error", code: status }}), { status, headers: { 'Content-Type': 'application/json' }});
        }
    }
}

export async function handleOpenAIEmbedding(
    apiKey: string, openAIRequest: OpenAIEmbeddingRequest
): Promise<Response> {
    const inputs = Array.isArray(openAIRequest.input) ? openAIRequest.input : [openAIRequest.input];
    let contentToEmbed: string | Part | (string | Part)[];

    if (typeof openAIRequest.input === 'string') {
        contentToEmbed = openAIRequest.input;
    } else if (Array.isArray(openAIRequest.input)) {
        contentToEmbed = openAIRequest.input;
    } else {
        return new Response(JSON.stringify({ error: { message: "Input must be a non-empty string or array of strings."}}), {status: 400});
    }

    const geminiParams: EmbedSdxContentParams = {
        model: openAIRequest.model, contents: contentToEmbed, config: {},
    };
    if (openAIRequest.dimensions) geminiParams.config!.outputDimensionality = openAIRequest.dimensions;

    try {
        const geminiResult: EmbedContentResponse = await embedSdxContent(apiKey, geminiParams);
        let openaiEmbeddings: any[] = [];
        
        const embeddingValues = (geminiResult as any).embeddings?.values; // Adjusted based on previous assumption

        if (embeddingValues) {
             // OpenAI spec for embeddings returns an array of embedding objects, one for each input string.
             // Gemini's embedContent (singular) returns one embedding. If multiple inputs were passed to Gemini
             // via batchEmbedContents (not currently used here), it would be different.
             // For now, if multiple strings were in input, we are only getting one embedding from Gemini.
             // This mapping assumes the single Gemini embedding applies to all or the first input.
             // This is a known simplification.
            if (Array.isArray(openAIRequest.input)) {
                 openaiEmbeddings = openAIRequest.input.map((_item, i) => ({
                    object: "embedding", index: i, embedding: i === 0 ? embeddingValues : [], // Simplification: only first gets embedding
                }));
                 if (openAIRequest.input.length > 1) {
                    console.warn("OpenAI embedding with array input: Gemini `embedSdxContent` returned a single vector. Mapping may be incorrect for multiple distinct embeddings. Only first input receives the embedding.");
                 }
            } else {
                 openaiEmbeddings = [{ object: "embedding", index: 0, embedding: embeddingValues }];
            }
        }

        const openAIUsage: OpenAIUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const openAIResponse = {
            object: "list", data: openaiEmbeddings, model: openAIRequest.model, usage: openAIUsage,
        };
        return new Response(JSON.stringify(openAIResponse), { headers: { 'Content-Type': 'application/json; charset=utf-8' }});
    } catch (error) {
        const status = (error as any)?.status ?? 500;
        return new Response(JSON.stringify({ error: { message: (error as Error).message || "Embedding failed", type: (error as any)?.name || "gemini_error", code: status }}), { status, headers: { 'Content-Type': 'application/json' }});
    }
}

// New function to handle OpenAI /v1/models
export async function handleOpenAIModelsList(apiKey: string): Promise<Response> {
    try {
        const geminiModelsResponse: RestListModelsResponse = await listSdxModels(apiKey);
        const openAIModels = geminiModelsResponse.models
            .filter(model => typeof model.name === 'string' && model.name.length > 0) // Ensure model.name is a non-empty string
            .map((model: SdkModel) => {
                // model.name is now guaranteed to be a string here
                const modelId = model.name!.startsWith("models/") ? model.name!.substring(7) : model.name!;
                return {
                    id: modelId,
                    object: "model" as "model",
                    created: Math.floor(Date.now() / 1000), // Consistent placeholder as createTime is not available
                    owned_by: "google" as "google",
                    permission: [], // OpenAI usually expects an array for permissions, even if empty
                    root: modelId,
                    parent: null,
                };
            });

        return new Response(JSON.stringify({ object: "list", data: openAIModels }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } catch (error) {
        console.error("Error fetching or transforming model list for OpenAI:", error);
        const status = (error as any)?.status ?? 500;
        return new Response(JSON.stringify({ error: { message: (error as Error).message || "Failed to list models for OpenAI", type: "model_list_error", code: status }}), {
            status: status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}
