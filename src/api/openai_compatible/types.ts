import {
    Content,
    HarmCategory,
    HarmBlockThreshold,
    SdkConfigOptions, // Needed for transformOpenAIConfigToSdkConfigOptions
    FinishReason, // Import FinishReason
} from "../../api/gemini_sdk/index.ts"; // Adjusted path

// --- Interfaces for OpenAI-style requests (simplified) ---
export interface OpenAIChatCompletionRequest {
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
    reasoning?: { // Added reasoning
        effort?: "low" | "medium" | "high";
    };
}

export interface OpenAIEmbeddingRequest {
    model: string;
    input: string | string[];
    dimensions?: number;
}

export interface OpenAIUsage {
    prompt_tokens: number;
    completion_tokens: number; // Actual visible output tokens
    input_tokens: number; // Total input tokens
    output_tokens: number; // Total output tokens
    total_tokens: number;
    output_tokens_details?: { // Added for reasoning tokens
        reasoning_tokens?: number;
    };
    input_tokens_details?: { // Added for cached tokens
        cached_tokens?: number;
    };
}

export interface GeminiCandidate {
  content?: Content;
  finishReason?: FinishReason; // Use imported FinishReason type
  [key: string]: any;
}

// --- Shared Constants for Transformation ---
export const defaultSafetySettings: Array<{category: HarmCategory; threshold: HarmBlockThreshold}> = [
  { category: "HARM_CATEGORY_HATE_SPEECH" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_HARASSMENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
];

export const fieldsMap: { [key: string]: string } = {
  stop: "stopSequences",
  n: "candidateCount",
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  top_k: "topK",
};

// This type is implicitly used by transformOpenAIConfigToSdkConfigOptions
export type { SdkConfigOptions };

// --- OpenAI Image Generation ---
export interface OpenAIImageGenerationRequest {
    prompt: string;
    model?: string; // Optional, DALL-E model or can be used to map to Gemini/Imagen
    n?: number; // Number of images to generate (1-10 for DALL-E, we'll adapt for Gemini/Imagen)
    quality?: 'standard' | 'hd'; // For DALL-E 3
    response_format?: 'url' | 'b64_json'; // We will primarily support b64_json
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792'; // DALL-E sizes, Gemini/Imagen might have different constraints or use aspectRatio
    style?: 'vivid' | 'natural'; // For DALL-E 3
    user?: string; // End-user identifier
}

export interface OpenAIImageDataBase64 {
    b64_json: string; // Base64 encoded image string
    revised_prompt?: string; // For DALL-E 3 if prompt was rewritten
}

export interface OpenAIImageDataUrl {
    url: string; // URL to the image
    revised_prompt?: string; // For DALL-E 3 if prompt was rewritten
}

export interface OpenAIImageGenerationResponse {
    created: number; // Timestamp
    data: (OpenAIImageDataBase64 | OpenAIImageDataUrl)[];
    usage?: OpenAIUsage; // Added usage field
}
