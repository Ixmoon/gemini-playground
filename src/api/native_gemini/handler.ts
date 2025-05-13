import { nativeRoutes } from "./routes.ts";
import { buildSdkConfigOptions } from "./utils.ts";

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
