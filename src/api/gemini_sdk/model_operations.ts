import {
    SdkGoogleGenAI,
    CountSdxTokensParams,
    CountTokensResponse,
    RestListModelsResponse,
    Model,
    GEMINI_REST_API_ENDPOINT,
} from "./types.ts";

export async function countSdxTokens(
    apiKey: string,
    params: CountSdxTokensParams
): Promise<CountTokensResponse> {
    const ai = new SdkGoogleGenAI({ apiKey });
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
