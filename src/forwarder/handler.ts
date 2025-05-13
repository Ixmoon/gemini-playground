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
    // Helper function to log response body before applying CORS and returning
    async function logAndReturn(responseToLogInput: Response): Promise<Response> {
        const clonedResponse = responseToLogInput.clone();
        let bodyText = "[empty or unreadable]";
        try {
            const text = await clonedResponse.text();
            if (text) {
                bodyText = text;
                try {
                    const parsedJsonPayload = JSON.parse(text);
                    bodyText = JSON.stringify(parsedJsonPayload, null, 2);
                } catch (jsonParseError) { /* Not JSON, use raw text as is */ }
            } else {
                bodyText = "[empty body]";
            }
        } catch (e) {
            console.error("Forwarder: Error reading response body for logging:", e);
            bodyText = "[error reading body for logging]";
        }
        console.log(`Forwarder: [${request.method}] Sending Response body (content before final CORS headers apply):`, bodyText);
        return ensureCorsHeaders(responseToLogInput); // Apply CORS to the original response
    }

    await kvManager.openKv();

    const triggerKey = getTriggerKeyFromRequest(request);
    if (!triggerKey) return await logAndReturn(new Response("Trigger key not provided.", { status: 401 }));
    if (!await kvManager.isValidTriggerKey(triggerKey)) return await logAndReturn(new Response("Invalid trigger key.", { status: 403 }));

    const originalUrl = new URL(request.url);
    const rawTargetPath = originalUrl.pathname;

    // Determine target path, removing prefix if necessary
    const targetPath = rawTargetPath.startsWith(FORWARD_PATH_PREFIX)
        ? rawTargetPath.substring(FORWARD_PATH_PREFIX.length)
        : rawTargetPath;

    if (!targetPath || targetPath === "/") return await logAndReturn(new Response("Invalid forward path.", { status: 400 }));

    const pathType = classifyRequestPath(targetPath);

    if (pathType === 'unknown') {
        console.warn(`Unknown path type for targetPath: ${targetPath}`);
        return await logAndReturn(new Response("Unsupported API path.", { status: 404 }));
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
            console.error("Error reading request body in forwarder:", err);
            bodyHandlingError = ensureCorsHeaders(new Response("Error processing request body.", { status: 400 }));
        }
    }

    // Debug: Print request body (aim for one primary log entry)
    if (preParsedJson !== null) { // If JSON was successfully parsed
        try {
            console.log("Forwarder: Request body (parsed JSON):", JSON.stringify(preParsedJson, null, 2));
        } catch (stringifyError) {
            console.error("Forwarder: Error stringifying preParsedJson for logging:", stringifyError);
            // Fallback for the rare case stringify fails on a parsed object
            if (preReadText !== null && preReadText.length > 0) {
                 console.log("Forwarder: Request body (raw text, fallback after stringify error):", preReadText);
            } else {
                 console.log("Forwarder: Request body (parsed, but error during logging and no raw text available)");
            }
        }
    } else if (preReadText !== null && preReadText.length > 0) { // preReadText exists and is not empty, but wasn't parsed as JSON
        console.log("Forwarder: Request body (raw text):", preReadText);
    } else if (request.body && request.method !== "GET" && request.method !== "OPTIONS" && request.method !== "HEAD") {
        // This case means request.body exists, but preReadText was null or empty (e.g., if .text() failed or returned empty)
        console.log("Forwarder: Request body present but could not be logged as JSON or raw text (empty or pre-read issue).");
    }

    if (bodyHandlingError) {
        // bodyHandlingError is already a Response processed by ensureCorsHeaders
        const clonedForLog = bodyHandlingError.clone();
        let bodyText = "[empty or unreadable]";
        try {
            const text = await clonedForLog.text();
            if (text) {
                bodyText = text;
                try {
                    const parsedJsonPayload = JSON.parse(text);
                    bodyText = JSON.stringify(parsedJsonPayload, null, 2);
                } catch (jsonParseError) { /* Not JSON, use raw text as is */ }
            } else {
                bodyText = "[empty body]";
            }
        } catch (e) {
            console.error("Forwarder: Error reading bodyHandlingError for logging:", e);
            bodyText = "[error reading body for logging]";
        }
        console.log(`Forwarder: [${request.method}] Sending Response body (from bodyHandlingError, already has CORS headers):`, bodyText);
        return bodyHandlingError;
    }
    // --- End Request Body Pre-processing ---

    const distinctKeysAttemptLimit = await kvManager.getFailureThreshold();
    let distinctKeysAttemptedCount = 0;
    let lastErrorResponse: Response | null = null;
    const attemptedKeysInThisRequest = new Set<string>();

    while (distinctKeysAttemptedCount < distinctKeysAttemptLimit) {
        const apiKey = await kvManager.getNextAvailableApiKey();
        if (!apiKey) {
            const finalError = lastErrorResponse || new Response("No available API keys.", { status: 503 });
            return await logAndReturn(finalError);
        }
        if (attemptedKeysInThisRequest.has(apiKey)) {
            const totalApiKeysInPool = (await kvManager.getApiKeys()).length;
             if (attemptedKeysInThisRequest.size >= totalApiKeysInPool && totalApiKeysInPool > 0) {
                console.warn(`Forwarder: Exhausted all ${attemptedKeysInThisRequest.size} unique keys.`);
                break;
            }
            continue;
        }
        attemptedKeysInThisRequest.add(apiKey);
        distinctKeysAttemptedCount++;

        try {
            let response: Response;

            if (pathType === 'native') {
                response = await handleNativeGeminiRequest(apiKey, request.method, targetPath, preParsedJson);
            } else if (pathType === 'openai') {
                if (!preParsedJson && preReadText !== null && preReadText !== "") {
                     response = new Response("OpenAI compatible requests require a JSON body.", { status: 400 });
                } else if (!preParsedJson && (targetPath.endsWith('/chat/completions') || targetPath.endsWith('/embeddings'))) {
                    response = new Response("Missing request body for OpenAI endpoint.", { status: 400 });
                } else {
                    if (targetPath.endsWith('/chat/completions')) {
                        response = await handleOpenAIChatCompletion(apiKey, preParsedJson);
                    } else if (targetPath.endsWith('/embeddings')) {
                        response = await handleOpenAIEmbedding(apiKey, preParsedJson);
                    } else if (targetPath.endsWith('/models')) {
                         response = await handleOpenAIModelsList(apiKey);
                    } else {
                         console.error(`Forwarder: Unexpected OpenAI (non-image) path ${targetPath}`);
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
                    response = await handleOpenAIImageGeneration(apiKey, preParsedJson);
                } else {
                    console.error(`Forwarder: Unexpected OpenAI Image path ${targetPath}`);
                    response = new Response("Internal server error for OpenAI Image path.", { status: 500 });
                }
            }
            else {
                 console.error(`Forwarder: Reached unexpected path type ${pathType}`);
                 response = new Response("Internal server error due to unhandled path type.", { status: 500 });
            }

            if (response.ok) {
                return await logAndReturn(response);
            } else {
                 console.warn(`Forwarder: Handler failed for key ...${apiKey.slice(-4)}, Status: ${response.status}`);
                lastErrorResponse = response.clone();
                 continue;
            }

        } catch (error) {
            console.error(`Forwarder: Unexpected error during handler call with key ...${apiKey.slice(-4)}:`, error);
            lastErrorResponse = new Response(JSON.stringify({ error: { message: (error as Error).message || "Internal Server Error in handler" } }), {
                status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
            continue;
        }
    }

    const finalErrorMessage = `Forwarder: All API key attempts failed after trying ${distinctKeysAttemptedCount} key(s).`;
    console.error(finalErrorMessage);
    const finalErrorResponse = lastErrorResponse || new Response(finalErrorMessage, { status: 503 });
    return await logAndReturn(finalErrorResponse);
}
