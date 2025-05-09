import * as kvManager from './kv_manager.ts';
import { handleNativeGeminiRequest } from "./gemini.ts";
import { handleOpenAIChatCompletion, handleOpenAIEmbedding, handleOpenAIModelsList } from "./openaitogemini.ts"; // Added handleOpenAIModelsList

const FORWARD_PATH_PREFIX = "/api"; // Keep if still relevant for entry point detection

// Helper function remains the same
function getTriggerKeyFromRequest(request: Request): string | null {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.substring(7).trim();
    }
    const googApiKeyHeader = request.headers.get("x-goog-api-key");
    if (googApiKeyHeader) {
        return googApiKeyHeader.trim();
    }
    return null;
}

// Helper function remains the same
function ensureCorsHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    if (!newHeaders.has("Access-Control-Allow-Origin")) newHeaders.set("Access-Control-Allow-Origin", "*");
    if (!newHeaders.has("Access-Control-Allow-Methods")) newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    if (!newHeaders.has("Access-Control-Allow-Headers")) newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-goog-api-key, x-goog-api-client");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

// Path classification remains the same
function classifyRequestPath(pathname: string): 'native' | 'openai' | 'unknown' {
    // Native Gemini paths (examples)
    if (pathname.includes(':generateContent') ||
        pathname.includes(':streamGenerateContent') ||
        pathname.includes(':embedContent') ||
        pathname.includes(':batchEmbedContents') ||
        pathname.includes(':countTokens') ||
        pathname.startsWith('/models') ||
        pathname.startsWith('/tunedModels')) {
        return 'native';
    }
    // OpenAI compatible paths (examples)
    if (pathname.endsWith('/chat/completions') ||
        pathname.endsWith('/embeddings') ||
        pathname.endsWith('/models')) { // OpenAI model listing path
        return 'openai';
    }
    return 'unknown';
}

export async function handleForwardedRequest(request: Request): Promise<Response> {
    await kvManager.openKv();

    const triggerKey = getTriggerKeyFromRequest(request);
    if (!triggerKey) return ensureCorsHeaders(new Response("Trigger key not provided.", { status: 401 }));
    if (!await kvManager.isValidTriggerKey(triggerKey)) return ensureCorsHeaders(new Response("Invalid trigger key.", { status: 403 }));

    const originalUrl = new URL(request.url);
    const rawTargetPath = originalUrl.pathname;

    // Determine target path, removing prefix if necessary
    const targetPath = rawTargetPath.startsWith(FORWARD_PATH_PREFIX)
        ? rawTargetPath.substring(FORWARD_PATH_PREFIX.length)
        : rawTargetPath;

    if (!targetPath || targetPath === "/") return ensureCorsHeaders(new Response("Invalid forward path.", { status: 400 }));

    const pathType = classifyRequestPath(targetPath);

    if (pathType === 'unknown') {
        console.warn(`Unknown path type for targetPath: ${targetPath}`);
        return ensureCorsHeaders(new Response("Unsupported API path.", { status: 404 }));
    }

    // --- Request Body Pre-processing ---
    // We still need to pre-parse the body here because the handlers might need it
    let preReadText: string | null = null;
    let preParsedJson: any = null;
    let bodyHandlingError: Response | null = null;
    const originalRequestClone = request.clone(); // Clone for potential retries

    // Only read body if it's likely to have one
    if (request.body && request.method !== "GET" && request.method !== "OPTIONS" && request.method !== "HEAD") {
        try {
            preReadText = await originalRequestClone.text(); // Read from clone
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
    if (bodyHandlingError) return bodyHandlingError;
    // --- End Request Body Pre-processing ---


    // --- API Key Rotation Loop ---
    const distinctKeysAttemptLimit = await kvManager.getFailureThreshold();
    let distinctKeysAttemptedCount = 0;
    let lastErrorResponse: Response | null = null;
    const attemptedKeysInThisRequest = new Set<string>();

    while (distinctKeysAttemptedCount < distinctKeysAttemptLimit) {
        const apiKey = await kvManager.getNextAvailableApiKey();
        if (!apiKey) {
            const finalError = lastErrorResponse || new Response("No available API keys.", { status: 503 });
            return ensureCorsHeaders(finalError);
        }
        if (attemptedKeysInThisRequest.has(apiKey)) {
            const totalApiKeysInPool = (await kvManager.getApiKeys()).length;
             if (attemptedKeysInThisRequest.size >= totalApiKeysInPool && totalApiKeysInPool > 0) {
                console.warn(`Forwarder: Exhausted all ${attemptedKeysInThisRequest.size} unique keys.`);
                break; // Exit loop
            }
            continue; // Skip already tried key
        }
        attemptedKeysInThisRequest.add(apiKey);
        distinctKeysAttemptedCount++;

        console.log(`Forwarder: Attempting API call with key ending in ...${apiKey.slice(-4)} (Attempt ${distinctKeysAttemptedCount}/${distinctKeysAttemptLimit})`);

        try {
            let response: Response;

            // Delegate based on path type
            if (pathType === 'native') {
                // Pass apiKey, request method, targetPath, and the pre-parsed body
                response = await handleNativeGeminiRequest(apiKey, request.method, targetPath, preParsedJson);
            } else if (pathType === 'openai') {
                // OpenAI handlers need the parsed JSON body
                if (!preParsedJson && preReadText !== null && preReadText !== "") {
                     // If body existed but wasn't JSON
                     response = new Response("OpenAI compatible requests require a JSON body.", { status: 400 });
                } else if (!preParsedJson && (targetPath.endsWith('/chat/completions') || targetPath.endsWith('/embeddings'))) {
                    // If body required but wasn't present or parsed
                    response = new Response("Missing request body for OpenAI endpoint.", { status: 400 });
                } else {
                    // Route to specific OpenAI handler
                    if (targetPath.endsWith('/chat/completions')) {
                        response = await handleOpenAIChatCompletion(apiKey, preParsedJson);
                    } else if (targetPath.endsWith('/embeddings')) {
                        response = await handleOpenAIEmbedding(apiKey, preParsedJson);
                    } else if (targetPath.endsWith('/models')) {
                         response = await handleOpenAIModelsList(apiKey); // Call the new handler
                    } else {
                         // Should not happen if classifyRequestPath is correct
                         console.error(`Forwarder: Unexpected OpenAI path ${targetPath}`);
                         response = new Response("Internal server error.", { status: 500 });
                    }
                }
            } else {
                 // Should not be reached
                 console.error(`Forwarder: Reached unexpected path type ${pathType}`);
                 response = new Response("Internal server error.", { status: 500 });
            }

            // Check response from handler
            if (response.ok) {
                console.log(`Forwarder: Successful API call with key ending ...${apiKey.slice(-4)}`);
                return ensureCorsHeaders(response); // Success, return response
            } else {
                // Handler returned an error response, treat as key failure for retry logic
                 console.warn(`Forwarder: Handler failed for key ...${apiKey.slice(-4)}, Status: ${response.status}`);
                lastErrorResponse = response.clone();
                 // Consider incrementing key failure count here via kvManager if desired
                 continue; // Try next key
            }

        } catch (error) {
            // Catch errors from the handler calls themselves (e.g., unexpected exceptions in handlers)
            console.error(`Forwarder: Unexpected error during handler call with key ...${apiKey.slice(-4)}:`, error);
            lastErrorResponse = new Response(JSON.stringify({ error: { message: (error as Error).message || "Internal Server Error in handler" } }), {
                status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
             // Consider incrementing key failure count here
            continue; // Try next key
        }
    } // End while loop

    // If loop finishes, all attempts failed
    const finalErrorMessage = `Forwarder: All API key attempts failed after trying ${distinctKeysAttemptedCount} key(s).`;
    console.error(finalErrorMessage);
    // Return the last error encountered, or a generic 503
    const finalErrorResponse = lastErrorResponse || new Response(finalErrorMessage, { status: 503 });
    return ensureCorsHeaders(finalErrorResponse);
}

// Keep this if the prefix logic is still used by the entry point (e.g., Deno server)
export function isForwarderRequest(pathname: string): boolean {
    return pathname.startsWith(FORWARD_PATH_PREFIX);
}
