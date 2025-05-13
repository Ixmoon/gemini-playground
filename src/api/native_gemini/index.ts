// Re-export the main handler function
export { handleNativeGeminiRequest } from "./handler.ts";

// Optionally, re-export types if they are needed by other modules
export type { NativeRoute, RouteHandlerParams } from "./types.ts";
