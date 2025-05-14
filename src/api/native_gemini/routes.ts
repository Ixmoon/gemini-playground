import {
    generateSdxContent,
    generateSdxContentStream,
    embedSdxContent,
    countSdxTokens,
    listSdxModels,
    getSdxModel,
    batchEmbedSdxContents,
    GenerateSdxContentParams,
    EmbedContentRequest,
    BatchEmbedContentsRequest,
    BatchEmbedContentRequestItem,
    BatchEmbedContentsResponse,
    CountSdxTokensParams,
    Model as SdkModel,
    RestListModelsResponse,
    // Image generation imports
    generateSdxImageWithGemini,
    generateSdxImageWithImagen,
    GenerateImageGeminiSdxParams,
    GenerateImageImagenParams,
    Modality, // Import Modality for validation if needed
    GenerateContentResponse, // Added for explicit typing in TransformStream
} from "../gemini_sdk/index.ts"; // Adjusted path
import { NativeRoute, RouteHandlerParams } from "./types.ts";
import { iterableToReadableStream } from "../openai_compatible/stream_transformer.ts"; // Added for stream optimization

// Route table
export const nativeRoutes: NativeRoute[] = [
    {
        pathPattern: /^\/?models\/?$/i, // Matches /models or /models/
        method: 'GET',
        requiresBody: false,
        actionPath: false,
        handler: async (apiKey, _params: RouteHandlerParams) => {
            const result: RestListModelsResponse = await listSdxModels(apiKey);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /^\/?models\/([^/:]+)$/i, // Matches /models/{model_id}
        method: 'GET',
        requiresBody: false,
        actionPath: false,
        handler: async (apiKey, params: RouteHandlerParams) => {
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
        handler: async (apiKey, params: RouteHandlerParams) => {
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
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for streamGenerateContent.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for streamGenerateContent.", { status: 400 });
            const genParams: GenerateSdxContentParams = { model: params.modelName, contents: params.requestBody.contents, config: params.sdkConfigOptions };
            const stream = await generateSdxContentStream(apiKey, genParams);
            const geminiReadableStream = iterableToReadableStream(stream);

            const sseTransformer = new TransformStream<GenerateContentResponse, Uint8Array>({
                transform(chunk, controller) {
                    const encoder = new TextEncoder();
                    try {
                        // Ensure the chunk is what we expect (GenerateContentResponse)
                        // and then stringify it for the SSE data field.
                        const sseFormattedChunk = `data: ${JSON.stringify(chunk)}\n\n`;
                        controller.enqueue(encoder.encode(sseFormattedChunk));
                    } catch (e) {
                        console.error("Error encoding native Gemini stream chunk:", e);
                        // Optionally, enqueue an error message or handle differently
                        // For now, re-throwing will propagate to the stream's error handling
                        controller.error(e); 
                    }
                }
            });

            const finalStream = geminiReadableStream.pipeThrough(sseTransformer);
            
            return new Response(finalStream, { status: 200, headers: { 'Content-Type': 'text/event-stream;charset=UTF-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):embedContent$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for embedContent.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' (string or Content object) in request body for embedContent.", { status: 400 });

            const embedCallParams: EmbedContentRequest = {
                model: params.modelName,
                contents: params.requestBody.contents,
                taskType: params.requestBody.taskType,
                title: params.requestBody.title,
                config: params.requestBody.outputDimensionality !== undefined
                        ? { outputDimensionality: params.requestBody.outputDimensionality }
                        : undefined
            };

            if (embedCallParams.taskType === undefined) delete embedCallParams.taskType;
            if (embedCallParams.title === undefined) delete embedCallParams.title;
            if (embedCallParams.config === undefined) delete embedCallParams.config;

            const result = await embedSdxContent(apiKey, embedCallParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):countTokens$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for countTokens.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for countTokens.", { status: 400 });
            const countParams: CountSdxTokensParams = { model: params.modelName, contents: params.requestBody.contents };
            const result = await countSdxTokens(apiKey, countParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):batchEmbedContents$/i,
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for batchEmbedContents.", { status: 400 });
            if (!params.requestBody?.requests || !Array.isArray(params.requestBody.requests)) {
                return new Response("Missing 'requests' array in request body for batchEmbedContents.", { status: 400 });
            }

            const batchCallParams: BatchEmbedContentsRequest = {
                model: params.modelName,
                requests: params.requestBody.requests.map((reqItem: any) => {
                    const item: BatchEmbedContentRequestItem = {
                        contents: reqItem.content,
                        taskType: reqItem.taskType,
                        title: reqItem.title,
                        config: reqItem.outputDimensionality !== undefined
                                ? { outputDimensionality: reqItem.outputDimensionality }
                                : undefined,
                        model: reqItem.model
                    };
                    if (item.taskType === undefined) delete item.taskType;
                    if (item.title === undefined) delete item.title;
                    if (item.config === undefined) delete item.config;
                    if (item.model === undefined) delete item.model;
                    return item;
                })
            };

            const result: BatchEmbedContentsResponse = await batchEmbedSdxContents(apiKey, batchCallParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    // Route for Gemini Image Generation (mimics generateContent structure)
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):generateImageWithGemini$/i, // New action
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for generateImageWithGemini.", { status: 400 });
            if (!params.requestBody?.contents) return new Response("Missing 'contents' in request body for generateImageWithGemini.", { status: 400 });
            if (!params.sdkConfigOptions?.responseModalities || !params.sdkConfigOptions.responseModalities.includes(Modality.IMAGE)) {
                return new Response("Missing or invalid 'responseModalities' in request body config. Must include 'IMAGE'.", { status: 400 });
            }

            // sdkConfigOptions should be defined here because requiresBody is true.
            // The validation for responseModalities has already run.
            if (!params.sdkConfigOptions) {
                // This case should ideally not be hit due to requiresBody flag and prior checks.
                return new Response("Internal error: sdkConfigOptions not available.", { status: 500 });
            }

            const configForCall: GenerateImageGeminiSdxParams['config'] = {
                ...params.sdkConfigOptions, // Spread all general SDK options
                // Ensure responseModalities is explicitly what we validated.
                // SdkConfigOptions makes responseModalities optional, 
                // GenerateImageGeminiSdxConfig (via GenerateImageGeminiSdxParams['config']) makes it mandatory.
                // The previous validation ensures sdkConfigOptions.responseModalities is not undefined here.
                responseModalities: params.sdkConfigOptions.responseModalities!, // Use non-null assertion as it's validated
            };
            
            // Remove any undefined general SdkConfigOptions that might have been spread
            // if they were optional and not present in the original sdkConfigOptions.
            // This step is more for cleanliness if SdkConfigOptions had many optional fields not set.
            // However, GenerateImageGeminiSdxParams['config'] expects all SdkConfigOptions fields.
            // The key is that `responseModalities` is now correctly typed and guaranteed.

            const geminiImageParams: GenerateImageGeminiSdxParams = {
                model: params.modelName,
                contents: params.requestBody.contents,
                config: configForCall
            };
            
            const result = await generateSdxImageWithGemini(apiKey, geminiImageParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
    // Route for Imagen Image Generation
    {
        pathPattern: /\/(?:models|tunedModels)\/([^/:]+):generateImageWithImagen$/i, // New action
        method: 'POST',
        requiresBody: true,
        actionPath: true,
        handler: async (apiKey, params: RouteHandlerParams) => {
            if (!params.modelName) return new Response("Model name required for generateImageWithImagen.", { status: 400 });
            if (!params.requestBody?.prompt) return new Response("Missing 'prompt' (string) in request body for generateImageWithImagen.", { status: 400 });
            
            // Imagen config is simpler and directly from requestBody.config or requestBody.generationConfig
            // The buildSdkConfigOptions might have already pulled some of these if named similarly,
            // but Imagen's config is specific (numberOfImages, aspectRatio, personGeneration).
            // We'll prefer direct properties from requestBody for Imagen config.
            const imagenConfig = params.requestBody?.config || params.requestBody?.generationConfig || {};

            const imagenImageParams: GenerateImageImagenParams = {
                model: params.modelName,
                prompt: params.requestBody.prompt,
                config: { // Construct Imagen3Config specifically
                    numberOfImages: imagenConfig.numberOfImages,
                    aspectRatio: imagenConfig.aspectRatio,
                    personGeneration: imagenConfig.personGeneration,
                }
            };

            // Remove undefined properties from config to keep it clean
            if (imagenImageParams.config) {
                Object.keys(imagenImageParams.config).forEach(key => (imagenImageParams.config as any)[key] === undefined && delete (imagenImageParams.config as any)[key]);
                if (Object.keys(imagenImageParams.config).length === 0) {
                    delete imagenImageParams.config;
                }
            }

            const result = await generateSdxImageWithImagen(apiKey, imagenImageParams);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    }
];
