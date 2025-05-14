import { SdkConfigOptions } from "../gemini_sdk/index.ts"; // Adjusted path
import { defaultSafetySettings } from "./types.ts";

// Helper to build SdkConfigOptions from request body
export function buildSdkConfigOptions(nativeBody: any): SdkConfigOptions {
    const sdkConfig: SdkConfigOptions = {
        ...(nativeBody.config || {}),
        ...(nativeBody.generationConfig || {}),
        systemInstruction: nativeBody.systemInstruction || nativeBody.system_instruction,
        safetySettings: defaultSafetySettings, // ALWAYS enforce OFF
        tools: nativeBody.tools,
        toolConfig: nativeBody.toolConfig,
        temperature: nativeBody.temperature ?? nativeBody.generationConfig?.temperature ?? nativeBody.config?.temperature,
        maxOutputTokens: nativeBody.maxOutputTokens ?? nativeBody.generationConfig?.maxOutputTokens ?? nativeBody.config?.maxOutputTokens,
        topP: nativeBody.topP ?? nativeBody.generationConfig?.topP ?? nativeBody.config?.topP,
        topK: nativeBody.topK ?? nativeBody.generationConfig?.topK ?? nativeBody.config?.topK,
        candidateCount: nativeBody.candidateCount ?? nativeBody.generationConfig?.candidateCount ?? nativeBody.config?.candidateCount,
        stopSequences: nativeBody.stopSequences ?? nativeBody.generationConfig?.stopSequences ?? nativeBody.config?.stopSequences,
        responseMimeType: nativeBody.responseMimeType ?? nativeBody.config?.responseMimeType ?? nativeBody.generationConfig?.responseMimeType,
        responseSchema: nativeBody.responseSchema ?? nativeBody.config?.responseSchema ?? nativeBody.generationConfig?.responseSchema,
        responseModalities: nativeBody.responseModalities ?? nativeBody.config?.responseModalities ?? nativeBody.generationConfig?.responseModalities,
        // thinkingConfig: nativeBody.thinkingConfig ?? nativeBody.config?.thinkingConfig ?? nativeBody.generationConfig?.thinkingConfig, // Original line
    };

    // Explicitly handle thinkingConfig to include it only if thinkingBudget is defined (including 0)
    const tc = nativeBody.thinkingConfig ?? nativeBody.config?.thinkingConfig ?? nativeBody.generationConfig?.thinkingConfig;
    if (tc && tc.thinkingBudget !== undefined && tc.thinkingBudget !== null) {
        sdkConfig.thinkingConfig = { thinkingBudget: tc.thinkingBudget };
    }

    Object.keys(sdkConfig).forEach(key => sdkConfig[key as keyof SdkConfigOptions] === undefined && delete sdkConfig[key as keyof SdkConfigOptions]);
    return sdkConfig;
}
