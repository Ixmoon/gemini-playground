import * as kvManager from '../kv_manager.ts';
import { handleNativeGeminiRequest } from '../api/native_gemini/index.ts';
import { 
    handleOpenAIChatCompletion, 
    handleOpenAIEmbedding, 
    handleOpenAIModelsList,
    handleOpenAIImageGeneration // Added image handler
} from '../api/openai_compatible/index.ts';
import { getTriggerKeyFromRequest, ensureCorsHeaders, classifyRequestPath, FORWARD_PATH_PREFIX } from './utils.ts';

export async function handleForwardedRequest(request: Request): Promise<Response> {
    await kvManager.openKv();

    const userProvidedKey = getTriggerKeyFromRequest(request);
    if (!userProvidedKey) {
        return ensureCorsHeaders(new Response("API key or trigger key not provided in Authorization or x-goog-api-key header.", { status: 401 }));
    }

    const originalUrl = new URL(request.url);
    const rawTargetPath = originalUrl.pathname;

    // Determine target path, removing prefix if necessary
    const targetPath = rawTargetPath.startsWith(FORWARD_PATH_PREFIX)
        ? rawTargetPath.substring(FORWARD_PATH_PREFIX.length)
        : rawTargetPath;

    if (!targetPath || targetPath === "/") return ensureCorsHeaders(new Response("Invalid forward path.", { status: 400 }));

    const pathType = classifyRequestPath(targetPath);

    if (pathType === 'unknown') {
        return ensureCorsHeaders(new Response("Unsupported API path.", { status: 404 }));
    }

    // --- Request Body Pre-processing ---
    let preReadText: string | null = null;
    let preParsedJson: any = null;
    let bodyHandlingError: Response | null = null;
    const originalRequestClone = request.clone();

    if (request.body && request.method !== "GET" && request.method !== "OPTIONS" && request.method !== "HEAD") {
        try {
            preReadText = await originalRequestClone.text();
            if (preReadText) {
                try {
                    preParsedJson = JSON.parse(preReadText);
                } catch (e) { /* Not JSON, handled by specific handlers */ }
            }
        } catch (err) {
            bodyHandlingError = ensureCorsHeaders(new Response("Error processing request body.", { status: 400 }));
        }
    }

    if (bodyHandlingError) {
        return bodyHandlingError;
    }
    // --- End Request Body Pre-processing ---

    // Helper function to make the actual API call based on pathType
    async function executeApiCall(apiKeyToUse: string): Promise<Response> {
        let response: Response;
        // pathType, request.method, targetPath, preParsedJson, preReadText are from the outer scope
        if (pathType === 'native') {
            response = await handleNativeGeminiRequest(apiKeyToUse, request.method, targetPath, preParsedJson);
        } else if (pathType === 'openai') {
            if (!preParsedJson && preReadText !== null && preReadText !== "") {
                 response = new Response("OpenAI compatible requests require a JSON body.", { status: 400 });
            } else if (!preParsedJson && (targetPath.endsWith('/chat/completions') || targetPath.endsWith('/embeddings'))) {
                response = new Response("Missing request body for OpenAI endpoint.", { status: 400 });
            } else {
                if (targetPath.endsWith('/chat/completions')) {
                    response = await handleOpenAIChatCompletion(apiKeyToUse, preParsedJson);
                } else if (targetPath.endsWith('/embeddings')) {
                    response = await handleOpenAIEmbedding(apiKeyToUse, preParsedJson);
                } else if (targetPath.endsWith('/models')) {
                     response = await handleOpenAIModelsList(apiKeyToUse);
                } else {
                     response = new Response("Internal server error for OpenAI path.", { status: 500 });
                }
            }
        } else if (pathType === 'openai_image') {
            if (!preParsedJson && preReadText !== null && preReadText !== "") {
                response = new Response("OpenAI compatible image requests require a JSON body.", { status: 400 });
            } else if (!preParsedJson && targetPath.endsWith('/images/generations')) {
               response = new Response("Missing request body for OpenAI image generation.", { status: 400 });
            }
            else if (targetPath.endsWith('/images/generations')) {
                response = await handleOpenAIImageGeneration(apiKeyToUse, preParsedJson);
            } else {
                response = new Response("Internal server error for OpenAI Image path.", { status: 500 });
            }
        }
        else {
             // This case should be caught by earlier pathType === 'unknown' check
             response = new Response("Internal server error due to unhandled path type.", { status: 500 });
        }
        return response;
    }

    const isTriggerAuth = await kvManager.isValidTriggerKey(userProvidedKey);

    if (isTriggerAuth) {
        // Extract model name from request body (preParsedJson) or path (for native Gemini)
        // For OpenAI, it's typically `preParsedJson.model`.
        // For native Gemini, it's extracted from paths like /[version]/models/model-name[:action] or /[version]/tunedModels/model-name[:action].
        let modelNameFromRequest: string | null = null;
        if (preParsedJson && typeof preParsedJson.model === 'string') {
            modelNameFromRequest = preParsedJson.model;
        } else if (pathType === 'native') {
            const v1betaModelsPrefix = "/v1beta/models/";
            if (targetPath.startsWith(v1betaModelsPrefix)) {
                // Extract the part after "/v1beta/models/"
                const modelIdentifier = targetPath.substring(v1betaModelsPrefix.length);
                // The model name is the part before the first colon (if any)
                const modelPart = modelIdentifier.split(':')[0];
                if (modelPart) { // Ensure modelPart is not an empty string
                    modelNameFromRequest = modelPart;
                }
            }
            // If pathType is 'native' but path doesn't start with /v1beta/models/,
            // modelNameFromRequest remains null (unless set from JSON body),
            // and no model name is extracted from the path.
        }
        // Add more specific model extraction logic if needed for other pathTypes or request structures

        const useFallback = modelNameFromRequest ? await kvManager.shouldUseFallbackKey(modelNameFromRequest) : false;

        if (useFallback) {
            const fallbackApiKey = await kvManager.getFallbackApiKey();
            if (fallbackApiKey) {
                // --- Trigger key scenario: Use single fallback key ---
                try {
                    const response = await executeApiCall(fallbackApiKey);
                    // If fallback key works, return response. If it fails, proceed to primary pool.
                    if (response.ok) {
                        return ensureCorsHeaders(response);
                    }
                    // If fallback fails, we'll fall through to the primary pool logic below.
                    // Log or handle the fallback failure if necessary, but the primary pool is the next attempt.
                    console.warn(`Fallback API key failed for model ${modelNameFromRequest}. Attempting primary pool.`);
                } catch (error) {
                    console.error(`Error using fallback API key for model ${modelNameFromRequest}:`, error);
                    // Fall through to primary pool logic
                }
            } else {
                // No fallback key is set, but it was indicated for this model. Proceed to primary pool.
                 console.warn(`Fallback key indicated for model ${modelNameFromRequest} but no fallback key is configured. Attempting primary pool.`);
            }
        }

        // --- Trigger key scenario: use primary key pool and retries (or if fallback failed/not configured) ---
        const distinctKeysAttemptLimit = await kvManager.getFailureThreshold();
        let distinctKeysAttemptedCount = 0;
        let lastErrorResponse: Response | null = null;
        const attemptedKeysInThisRequest = new Set<string>();

        while (distinctKeysAttemptedCount < distinctKeysAttemptLimit) {
            const apiKeyFromPool = await kvManager.getNextAvailableApiKey(); // Always use primary pool here
            if (!apiKeyFromPool) {
                const finalError = lastErrorResponse || new Response(`No available API keys from primary pool.`, { status: 503 });
                return ensureCorsHeaders(finalError);
            }
            if (attemptedKeysInThisRequest.has(apiKeyFromPool)) {
                const apiKeyRecord = await kvManager.getApiKeys();
                const totalApiKeysInPool = Object.values(apiKeyRecord).length;
                 if (attemptedKeysInThisRequest.size >= totalApiKeysInPool && totalApiKeysInPool > 0) {
                    // All keys in the primary pool have been tried
                    break; 
                }
                continue; // Skip if this key from primary pool has already been tried
            }
            attemptedKeysInThisRequest.add(apiKeyFromPool);
            distinctKeysAttemptedCount++;

            try {
                const response = await executeApiCall(apiKeyFromPool);

                if (response.ok) {
                    return ensureCorsHeaders(response);
                } else {
                    lastErrorResponse = response.clone();
                    // continue to try next key from pool
                }
            } catch (error) {
                lastErrorResponse = new Response(JSON.stringify({ error: { message: (error as Error).message || "Internal Server Error in handler" } }), {
                    status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
                });
                // continue to try next key from pool
            }
        } // end while loop for key pooling

        const finalErrorMessage = `Forwarder: All API key attempts from pool failed after trying ${distinctKeysAttemptedCount} key(s).`;
        const finalErrorResponse = lastErrorResponse || new Response(finalErrorMessage, { status: 503 });
        return ensureCorsHeaders(finalErrorResponse);

    } else {
        // --- New scenario: userProvidedKey is the actual API key, no pooling, no retries ---
        const actualApiKey = userProvidedKey;

        try {
            const response = await executeApiCall(actualApiKey);

            if (response.ok) {
                return ensureCorsHeaders(response);
            } else {
                // If the direct key fails, we return its response directly. No retries.
                return ensureCorsHeaders(response);
            }
        } catch (error) {
            const errorResponse = new Response(JSON.stringify({ error: { message: (error as Error).message || "Internal Server Error in handler" } }), {
                status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
            return ensureCorsHeaders(errorResponse);
        }
    }
}
