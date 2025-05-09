import {
    generateSdxContent,
    generateSdxContentStream,
    embedSdxContent,
    countSdxTokens,
    listSdxModels,
    getSdxModel,
    GenerateSdxContentParams,
    EmbedSdxContentParams,
    CountSdxTokensParams,
    SdkConfigOptions,
    HarmCategory,
    HarmBlockThreshold,
    Model as SdkModel,
    RestListModelsResponse
} from "./geminiapi.ts";

// Common safety settings
const forcedSafetySettingsBlockNone = [
    { category: "HARM_CATEGORY_HATE_SPEECH" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_HARASSMENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
];

// Interface for route parameters (extracted from path or body)
interface RouteHandlerParams {
    modelName?: string; // For actions on a specific model
    requestBody: any | null;
    sdkConfigOptions?: SdkConfigOptions; // Common config for generation/embedding
    // specific path params can be added if regex captures groups
    pathParams?: RegExpMatchArray | null;
}

// Route definition
interface NativeRoute {
    pathPattern: RegExp;
    method: 'GET' | 'POST'; // Add other methods if needed
    handler: (apiKey: string, params: RouteHandlerParams) => Promise<Response>;
    requiresBody?: boolean;
    actionPath?: boolean; // Indicates if it's an action on a model (e.g., :generateContent)
}

// Helper to build SdkConfigOptions from request body
function buildSdkConfigOptions(nativeBody: any): SdkConfigOptions {
    const sdkConfig: SdkConfigOptions = {
        ...(nativeBody.config || {}),
        ...(nativeBody.generationConfig || {}),
        systemInstruction: nativeBody.systemInstruction || nativeBody.system_instruction,
        safetySettings: forcedSafetySettingsBlockNone, // ALWAYS enforce OFF
        tools: nativeBody.tools,
        toolConfig: nativeBody.toolConfig,
        thinkingConfig: nativeBody.thinkingConfig,
        temperature: nativeBody.temperature ?? nativeBody.generationConfig?.temperature ?? nativeBody.config?.temperature,
        maxOutputTokens: nativeBody.maxOutputTokens ?? nativeBody.generationConfig?.maxOutputTokens ?? nativeBody.config?.maxOutputTokens,
        topP: nativeBody.topP ?? nativeBody.generationConfig?.topP ?? nativeBody.config?.topP,
        topK: nativeBody.topK ?? nativeBody.generationConfig?.topK ?? nativeBody.config?.topK,
        candidateCount: nativeBody.candidateCount ?? nativeBody.generationConfig?.candidateCount ?? nativeBody.config?.candidateCount,
        stopSequences: nativeBody.stopSequences ?? nativeBody.generationConfig?.stopSequences ?? nativeBody.config?.stopSequences,
        responseMimeType: nativeBody.responseMimeType ?? nativeBody.config?.responseMimeType,
        responseSchema: nativeBody.responseSchema ?? nativeBody.config?.responseSchema,
    };
    Object.keys(sdkConfig).forEach(key => sdkConfig[key as keyof SdkConfigOptions] === undefined && delete sdkConfig[key as keyof SdkConfigOptions]);
    return sdkConfig;
}


// Route table
const nativeRoutes: NativeRoute[] = [
    {
        pathPattern: /^\/?models\/?$/i, // Matches /models or /models/
        method: 'GET',
        requiresBody: false,
        actionPath: false,
        handler: async (apiKey, _params) => {
            const result: RestListModelsResponse = await listSdxModels(apiKey);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /^\/?models\/([^/:]+)$/i, // Matches /models/{model_id}
        method: 'GET',
        requiresBody: false,
        actionPath: false,
        handler: async (apiKey, params) => {
            const modelId = params.pathParams ? params.pathParams[1] : null;
            if (!modelId) return new Response("Could not extract model ID.", { status: 400 });
            const result: SdkModel = await getSdxModel(apiKey, modelId);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):generateContent$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params) => {
            if (!params.modelName) return new Response("Model name required for generateContent.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for generateContent.", { status: 400 });
            const genParams: GenerateSdxContentParams = { model: params.modelName, contents: params.requestBody.contents, config: params.sdkConfigOptions };
            const result = await generateSdxContent(apiKey, genParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):streamGenerateContent$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params) => {
            if (!params.modelName) return new Response("Model name required for streamGenerateContent.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for streamGenerateContent.", { status: 400 });
            const genParams: GenerateSdxContentParams = { model: params.modelName, contents: params.requestBody.contents, config: params.sdkConfigOptions };
            const stream = await generateSdxContentStream(apiKey, genParams);
            const readableStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    try {
                        for await (const chunk of stream) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                        }
                        controller.close();
                    } catch (e) {
                        console.error("Error reading native Gemini stream:", e);
                        controller.error(e);
                    }
                }
            });
            return new Response(readableStream, { status: 200, headers: { 'Content-Type': 'text/event-stream;charset=UTF-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):embedContent$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params) => {
            if (!params.modelName) return new Response("Model name required for embedContent.", { status: 400 });
            if (!params.requestBody?.content) return new Response("Missing 'content' in request body for embedContent.", { status: 400 });
            const embedParams: EmbedSdxContentParams = {
                model: params.modelName, contents: params.requestBody.content,
                config: { 
                    taskType: params.requestBody.taskType, 
                    title: params.requestBody.title, 
                    outputDimensionality: params.requestBody.outputDimensionality 
                }
            };
            Object.keys(embedParams.config!).forEach(key => embedParams.config![key as keyof typeof embedParams.config] === undefined && delete embedParams.config![key as keyof typeof embedParams.config]);
            if (Object.keys(embedParams.config!).length === 0) delete embedParams.config;
            const result = await embedSdxContent(apiKey, embedParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):countTokens$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params) => {
            if (!params.modelName) return new Response("Model name required for countTokens.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for countTokens.", { status: 400 });
            const countParams: CountSdxTokensParams = { model: params.modelName, contents: params.requestBody.contents };
            const result = await countSdxTokens(apiKey, countParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    }
];

// Main handler function for native Gemini requests
export async function handleNativeGeminiRequest(
    apiKey: string,
    method: string, // HTTP method from the original request
    targetPath: string,
    requestBody: any | null // Pre-parsed JSON body from forwarder
): Promise<Response> {
    for (const route of nativeRoutes) {
        const pathParams = targetPath.match(route.pathPattern);
        if (pathParams && method.toUpperCase() === route.method) {
            // Basic body requirement check
            if (route.requiresBody && requestBody === null) {
                return new Response(`Request body required for ${targetPath}`, { status: 400 });
            }

            // Extract model name if it's an action path and pattern captures it
            let modelName: string | undefined = undefined;
            if (route.actionPath && pathParams[1]) {
                modelName = pathParams[1];
            } else if (route.actionPath && !pathParams[1]) {
                // This case should ideally be caught by more specific regex or handler logic
                return new Response(`Could not extract model name for action path: ${targetPath}`, { status: 400 });
            }
            
            const sdkConfigOptions = route.requiresBody ? buildSdkConfigOptions(requestBody || {}) : undefined;

            try {
                return await route.handler(apiKey, { modelName, requestBody, sdkConfigOptions, pathParams });
            } catch (error) {
                console.error(`Error in native route handler for ${targetPath}:`, error);
                const status = (error as any)?.status ?? ((error as any)?.response?.status) ?? 500;
                const message = (error as Error).message || "Internal handler error";
                const errorPayload = { error: { message: message, type: (error as Error).name || "gemini_native_route_error", code: status } };
                return new Response(JSON.stringify(errorPayload), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
            }
        }
    }

    console.warn(`No native route handler found for ${method} ${targetPath}`);
    return new Response(`Native path handler for ${method} ${targetPath} not implemented.`, { status: 404 }); // 404 for not found
}
