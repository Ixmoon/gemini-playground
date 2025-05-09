import {
    GoogleGenAI,
    GenerateContentResponse as SdkGenerateContentResponse,
    EmbedContentResponse as SdkEmbedContentResponse,
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
} from "@google/genai";

// --- Re-exporting core types AND ENUMS needed by other modules ---
// Type-only exports
export type Content = SdkContent;
export type GenerateContentResponse = SdkGenerateContentResponse;
export type EmbedContentResponse = SdkEmbedContentResponse;
export type CountTokensResponse = SdkCountTokensResponse;
export type Part = SdkPart;
export type Model = SdkModel; // Re-export Model type

// Re-export enums (these export both type and value)
export { HarmCategory, HarmBlockThreshold, FunctionCallingConfigMode };


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
}

export interface GenerateSdxContentParams {
    model: string;
    contents: Content[];
    config?: SdkConfigOptions;
}

export interface EmbedSdxContentParams {
    model: string;
    contents: string | Part | (string | Part)[];
    config?: {
        taskType?: string;
        title?: string;
        outputDimensionality?: number;
    };
}

export interface CountSdxTokensParams {
    model: string;
    contents: Content[];
}

// --- Custom types for REST API model responses ---
export interface RestListModelsResponse {
    models: Model[];
    nextPageToken?: string;
}

const GEMINI_REST_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

// --- Service Functions ---

export async function generateSdxContent(
    apiKey: string,
    params: GenerateSdxContentParams
): Promise<GenerateContentResponse> {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.generateContent(params);
}

export async function generateSdxContentStream(
    apiKey: string,
    params: GenerateSdxContentParams
): Promise<AsyncIterable<GenerateContentResponse>> {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.generateContentStream(params);
}

export async function embedSdxContent(
    apiKey: string,
    params: EmbedSdxContentParams
): Promise<EmbedContentResponse> {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.embedContent(params);
}

export async function countSdxTokens(
    apiKey: string,
    params: CountSdxTokensParams
): Promise<CountTokensResponse> {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.countTokens(params);
}

export async function listSdxModels(apiKey: string): Promise<RestListModelsResponse> {
    const response = await fetch(`${GEMINI_REST_API_ENDPOINT}/models`, {
        method: 'GET',
        headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Error listing models: ${response.status}`, errorBody);
        throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }
    return await response.json() as RestListModelsResponse;
}

export async function getSdxModel(apiKey: string, modelName: string): Promise<Model> {
     // modelName might be "models/gemini-pro" or "gemini-pro"
     // The REST API expects "models/gemini-pro"
    const fullModelName = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
    const response = await fetch(`${GEMINI_REST_API_ENDPOINT}/${fullModelName}`, {
        method: 'GET',
        headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Error getting model ${modelName}: ${response.status}`, errorBody);
        throw new Error(`Failed to get model ${modelName}: ${response.status} ${response.statusText}`);
    }
    return await response.json() as Model;
}
