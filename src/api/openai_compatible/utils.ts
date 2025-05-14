import {
    Content,
    Part,
} from "../../api/gemini_sdk/index.ts"; // Adjusted path
import {
    OpenAIChatCompletionRequest,
    OpenAIUsage,
    GeminiCandidate,
    SdkConfigOptions,
    defaultSafetySettings,
    fieldsMap,
    // Assuming OpenAITool may be defined in types.ts or we define a simplified one here for now
    // For now, we'll assume openAIRequest.tools are directly mappable if simple,
    // or require more complex transformation later.
} from "./types.ts";

export const transformOpenAIConfigToSdkConfigOptions = (req: OpenAIChatCompletionRequest): SdkConfigOptions => {
  const sdkConfig: SdkConfigOptions = {};

  // Direct mapping for simple config values
  if (req.temperature !== undefined) sdkConfig.temperature = req.temperature;
  if (req.top_p !== undefined) sdkConfig.topP = req.top_p;
  if (req.top_k !== undefined) sdkConfig.topK = req.top_k; // Ensure top_k is in fieldsMap or handled
  if (req.n !== undefined) sdkConfig.candidateCount = req.n;
  if (req.max_tokens !== undefined) sdkConfig.maxOutputTokens = req.max_tokens;
  
  if (req.stop) {
    if (typeof req.stop === 'string') {
      sdkConfig.stopSequences = [req.stop];
    } else if (Array.isArray(req.stop) && req.stop.every(s => typeof s === 'string')) {
      sdkConfig.stopSequences = req.stop;
    }
  }

  // Keep other specific mappings from fieldsMap if they are not covered above
  // This loop is now more for less common or differently named parameters
  for (const key in req) {
    if (key === "model" || key === "messages" || key === "stream" || key === "stream_options" || 
        key === "tools" || key === "tool_choice" || key === "reasoning" ||
        key === "temperature" || key === "top_p" || key === "top_k" || key === "n" || 
        key === "max_tokens" || key === "stop" || key === "response_format") continue;

    const matchedKey = fieldsMap[key as keyof typeof fieldsMap];
    if (matchedKey && req[key as keyof OpenAIChatCompletionRequest] !== undefined) {
        (sdkConfig as any)[matchedKey] = req[key as keyof OpenAIChatCompletionRequest];
    }
  }

  if (req.response_format?.type === "json_object") {
    sdkConfig.responseMimeType = "application/json";
  }

  // Handle reasoning.effort
  if (req.reasoning?.effort) {
    const effort = req.reasoning.effort.toLowerCase();
    let budget: number | undefined; // budget will be undefined if effort is not recognized
    if (effort === "low") budget = 1024;
    else if (effort === "medium") budget = 4096;
    else if (effort === "high") budget = 16384;
    
    if (budget !== undefined) {
      sdkConfig.thinkingConfig = { thinkingBudget: budget };
    }
  }

  sdkConfig.safetySettings = defaultSafetySettings; // Enforced OFF
  return sdkConfig;
};

export async function parseImgData(url: string): Promise<Part> {
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

export async function transformOpenAIMessagesToGeminiContents(
    messages: { role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }[] // Added tool_calls for assistant and tool_call_id/name for tool
): Promise<{ contents: Content[], systemInstruction?: Content }> {
    const geminiContents: Content[] = [];
    let systemInstruction: Content | undefined = undefined;

    for (const msg of messages) {
        const parts: Part[] = [];
        if (msg.role === "tool") { // Handle tool role (function response)
            if (msg.tool_call_id && msg.content) {
                 parts.push({
                    functionResponse: {
                        name: msg.name || msg.tool_call_id, // OpenAI uses tool_call_id, Gemini uses 'name' for the function called
                        response: { content: msg.content }, // Gemini expects a response object.
                    }
                });
            }
        } else if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) { // Multi-part content (text, image)
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
        
        // Handle OpenAI tool_calls from assistant message
        if (msg.role === "assistant" && msg.tool_calls) {
            for (const toolCall of msg.tool_calls) {
                if (toolCall.type === "function" && toolCall.function) {
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        parts.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: args,
                            }
                        });
                    } catch (e) {
                        console.warn(`Failed to parse function call arguments for ${toolCall.function.name}: ${ (e as Error).message}`);
                    }
                }
            }
        }

        if (parts.length > 0) {
            if (msg.role === "system") {
                systemInstruction = { role: "system", parts };
            } else {
                geminiContents.push({
                    role: msg.role === "assistant" ? "model" : (msg.role === "tool" ? "function" : "user"), // Map 'tool' to 'function'
                    parts,
                });
            }
        } else if (msg.role === "assistant" && !msg.content && !msg.tool_calls) {
            // Handle cases where assistant message might be empty but implies a role
             geminiContents.push({ role: "model", parts: [{text: ""}] }); // Gemini requires at least one part
        }
    }
    return { contents: geminiContents, systemInstruction };
}

export const generateOpenAIId = (prefix = "chatcmpl-") => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return prefix + Array.from({ length: 29 }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
};

export const geminiFinishReasonToOpenAI = (
    reason?: string | null, // Keep as string here, as SDK might return it as string
    geminiCandidate?: GeminiCandidate
): string | null => {
    if (!reason) return null;
    // Accessing geminiCandidate.content.parts which contains Part objects.
    // Part from "@google/genai" has an optional functionCall property.
    if (geminiCandidate?.content?.parts?.some((p: Part) => p.functionCall)) {
        return "tool_calls";
    }
    const map: { [key: string]: string } = {
        "STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter",
        "RECITATION": "content_filter", "OTHER": "stop", "UNKNOWN": "stop", // Common/Generic reasons
        "MODEL_UNSPECIFIED_FINISH_REASON": "stop", "FINISH_REASON_UNSPECIFIED": "stop", // More specific generic reasons
        "FUNCTION_CALL": "tool_calls", // Fallback for explicit function call reason
        // Add other specific FinishReason string values from the enum if needed for mapping.
        // For example, if FinishReason can be "BLOCKED_BY_SENDER", etc.
    };
    // Ensure `reason` is a string before calling toUpperCase()
    const upperReason = typeof reason === 'string' ? reason.toUpperCase() : "";
    return map[upperReason] || (typeof reason === 'string' ? reason.toLowerCase() : null);
};

export function transformGeminiCandidateToOpenAIChoice(
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

    // The `candidate.finishReason` is now of type `FinishReason | undefined`
    // The `geminiFinishReasonToOpenAI` function expects `string | null | undefined`
    // This is compatible as FinishReason is a string literal union.
    return { index: index, [messageOrDeltaKey]: outputPart, logprobs: null,
        finish_reason: geminiFinishReasonToOpenAI(candidate.finishReason, candidate),
    };
}

export function transformGeminiUsageToOpenAI(usageMetadata: any): OpenAIUsage { // usageMetadata is of type Gemini's UsageMetadata
    if (!usageMetadata) {
        return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }

    const promptTokens = usageMetadata.promptTokenCount || 0;
    const thoughtsTokens = usageMetadata.thoughtsTokenCount || 0;
    // Gemini's responseTokenCount likely includes thoughtsTokenCount + actual output tokens.
    // So, actual completion_tokens = responseTokenCount - thoughtsTokenCount.
    // OpenAI's completion_tokens refers to the actual visible output tokens.
    // Gemini's candidatesTokenCount might be the equivalent of OpenAI's completion_tokens if it already excludes thoughts.
    // Let's assume usageMetadata.responseTokenCount is the sum of thoughts + visible output,
    // and usageMetadata.candidatesTokenCount is just the visible output tokens.
    // If thoughtsTokenCount is present, we use it for reasoning_tokens.
    // OpenAI's completion_tokens should be the visible output.
    // If Gemini's `candidatesTokenCount` represents visible output tokens, we can use that directly.
    // If Gemini's `responseTokenCount` is the sum of visible and thought tokens, then visible = responseTokenCount - thoughtsTokenCount.

    // Based on the Gemini UsageMetadata interface:
    // promptTokenCount: number;
    // responseTokenCount?: number; // This seems to be the sum of all tokens generated by the model in response (thoughts + visible output)
    // thoughtsTokenCount?: number;
    // totalTokenCount?: number;
    // candidatesTokenCount is NOT in the UsageMetadata provided by the user.
    // So, we must derive visible completion tokens from responseTokenCount and thoughtsTokenCount.

    const visibleCompletionTokens = (usageMetadata.responseTokenCount || 0) - thoughtsTokens;

    const openAIUsage: OpenAIUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: visibleCompletionTokens < 0 ? 0 : visibleCompletionTokens, // Ensure not negative
        total_tokens: usageMetadata.totalTokenCount || 0,
    };

    if (thoughtsTokens > 0) {
        openAIUsage.output_tokens_details = {
            reasoning_tokens: thoughtsTokens,
        };
    }
    return openAIUsage;
}
