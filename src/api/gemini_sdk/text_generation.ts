import {
    SdkGoogleGenAI,
    GenerateSdxContentParams,
    GenerateContentResponse,
} from "./types.ts";

export async function generateSdxContent(
    apiKey: string,
    params: GenerateSdxContentParams
): Promise<GenerateContentResponse> {
    const ai = new SdkGoogleGenAI({ apiKey });
    return ai.models.generateContent(params);
}

export async function generateSdxContentStream(
    apiKey: string,
    params: GenerateSdxContentParams
): Promise<AsyncIterable<GenerateContentResponse>> {
    const ai = new SdkGoogleGenAI({ apiKey });
    return ai.models.generateContentStream(params);
}
