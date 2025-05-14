export const FORWARD_PATH_PREFIX = "/api"; // Moved from forwarder.ts

export function getTriggerKeyFromRequest(request: Request): string | null {
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

export function ensureCorsHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    if (!newHeaders.has("Access-Control-Allow-Origin")) newHeaders.set("Access-Control-Allow-Origin", "*");
    if (!newHeaders.has("Access-Control-Allow-Methods")) newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    if (!newHeaders.has("Access-Control-Allow-Headers")) newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-goog-api-key, x-goog-api-client");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

export function classifyRequestPath(pathname: string): 'native' | 'openai' | 'openai_image' | 'unknown' {
    // Native Gemini paths
    if (pathname.includes(':generateContent') ||
        pathname.includes(':streamGenerateContent') ||
        pathname.includes(':embedContent') ||
        pathname.includes(':batchEmbedContents') ||
        pathname.includes(':countTokens') ||
        pathname.includes(':generateImageWithGemini') || // Added native image route
        pathname.includes(':generateImageWithImagen') || // Added native image route
        pathname.startsWith('/v1beta/models')) { 
        return 'native';
    }
    // OpenAI compatible image generation path
    if (pathname.endsWith('/images/generations')) {
        return 'openai_image';
    }
    // Other OpenAI compatible paths
    if (pathname.endsWith('/chat/completions') ||
        pathname.endsWith('/embeddings') ||
        pathname.endsWith('/models')) { 
        return 'openai';
    }
    return 'unknown';
}

export function isForwarderRequest(pathname: string): boolean {
    return pathname.startsWith(FORWARD_PATH_PREFIX);
}
