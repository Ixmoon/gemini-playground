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
    fieldsMap
} from "./types.ts";

export const transformOpenAIConfigToSdkConfigOptions = (req: OpenAIChatCompletionRequest): SdkConfigOptions => {
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

export function transformGeminiUsageToOpenAI(usageMetadata: any): OpenAIUsage {
    if (!usageMetadata) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return {
        prompt_tokens: usageMetadata.promptTokenCount || 0,
        completion_tokens: usageMetadata.candidatesTokenCount || 0,
        total_tokens: usageMetadata.totalTokenCount || 0,
    };
}
