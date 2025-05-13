import {
    GoogleGenAI as SdkGoogleGenAI, // Renaming to avoid conflict if GoogleGenAI is used directly
    GenerateContentResponse as SdkGenerateContentResponse,
    CountTokensResponse as SdkCountTokensResponse,
    Content as SdkContent,
    SafetySetting as SdkSafetySettingInternal,
    GenerationConfig as SdkGenerationConfigInternal,
    Tool as SdkToolInternal,
    ToolConfig as SdkToolConfigInternal,
    Schema as SdkSchemaInternal,
    Part as SdkPart,
    HarmCategory,
    HarmBlockThreshold,
    FunctionCallingConfigMode,
    Model as SdkModel,
    ContentEmbedding as SdkContentEmbedding,
    FinishReason, // Added FinishReason
    Modality as SdkModality,
    PersonGeneration as SdkPersonGeneration, // Import the SDK's PersonGeneration type
} from "@google/genai";

// Re-export GoogleGenAI for use in other modules
export { SdkGoogleGenAI };

// --- Re-exporting core types AND ENUMS needed by other modules ---
// Type-only exports
export type Content = SdkContent;
export type GenerateContentResponse = SdkGenerateContentResponse;
// Note: SdkEmbedContentResponse is not directly re-exported as EmbedContentResponse will be custom.
export type CountTokensResponse = SdkCountTokensResponse;
export type Part = SdkPart;
export type Model = SdkModel; // Re-export Model type
export type ContentEmbedding = SdkContentEmbedding; // Export ContentEmbedding

// Re-export enums (these export both type and value)
export { HarmCategory, HarmBlockThreshold, FunctionCallingConfigMode, FinishReason, SdkModality as Modality }; // Added FinishReason and Modality


// --- Interfaces for parameters ---
export interface SdkSafetySetting extends SdkSafetySettingInternal {}
export interface SdkGenerationConfig extends SdkGenerationConfigInternal {}
export interface SdkTool extends SdkToolInternal {}
export interface SdkToolConfig extends SdkToolConfigInternal {}
export interface SdkSchema extends SdkSchemaInternal {}


export interface SdkConfigOptions {
    systemInstruction?: string | Content;
    safetySettings?: SdkSafetySetting[];
    tools?: SdkTool[];
    toolConfig?: SdkToolConfig;
    responseMimeType?: string;
    responseSchema?: SdkSchema;
    thinkingConfig?: {
        thinkingBudget?: number;
    };
    cachedContent?: string;
    candidateCount?: number;
    stopSequences?: string[];
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    responseModalities?: SdkModality[]; // For Gemini image generation
}

export interface GenerateSdxContentParams {
    model: string;
    contents: Content[];
    config?: SdkConfigOptions;
}

// For the 'config' object specifically for embedContent, as per new SDK guide
export interface EmbedConfig {
    outputDimensionality?: number;
}

// Parameter for ai.models.embedContent, new SDK expects contents: (string | Part)[]
export interface EmbedContentRequest {
    model: string;
    contents: (string | Part)[]; // CRITICAL CHANGE: Must be an array of strings or text Parts
    taskType?: string;
    title?: string;
    config?: EmbedConfig;
}

// New SDK's ai.models.embedContent returns { embeddings: ContentEmbedding[] }
export interface EmbedContentResponse {
    embeddings: SdkContentEmbedding[];
}


// ---- Batch Embedding Related (Simulated) ----
// Item structure as received in the batch request from client
export interface BatchEmbedContentRequestItem {
    model?: string;
    contents: Content | string; // This is what the client sends per item
    taskType?: string;
    title?: string;
    config?: EmbedConfig; // For outputDimensionality
}

export interface BatchEmbedContentsRequest {
    model: string; // Default model if not specified in items
    requests: BatchEmbedContentRequestItem[];
}

export interface BatchEmbedContentsResponse {
    embeddings: SdkContentEmbedding[];
}
// ---- End Batch Embedding Related ----

export interface CountSdxTokensParams {
    model: string;
    contents: Content[];
}

// --- Custom types for REST API model responses ---
export interface RestListModelsResponse {
    models: Model[];
    nextPageToken?: string;
}

export const GEMINI_REST_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

// ---- Imagen 3 Image Generation Types ----
export interface Imagen3Config {
    numberOfImages?: number; // 1-4, default 4
    aspectRatio?: string;    // "1:1", "16:9", etc.
    personGeneration?: SdkPersonGeneration; // Use the imported SDK type
    // Potentially other Imagen specific config options, e.g. seed, negativePrompt
}

export interface GenerateImageImagenParams {
    model: string; // e.g., "imagen-3.0-generate-002"
    prompt: string; // English text prompt
    config?: Imagen3Config;
}

export interface GeneratedImage {
    image: {
        imageBytes: string; // Base64 encoded image
    };
    // Potentially other fields like 'seed' or 'url' if SDK provides them
    // As per user doc, it's just imageBytes.
}

export interface GenerateImageImagenResponse {
    generatedImages: GeneratedImage[];
}
// ---- End Imagen 3 Image Generation Types ----
