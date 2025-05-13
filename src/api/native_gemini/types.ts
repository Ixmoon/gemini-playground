import {
    SdkConfigOptions,
    HarmCategory,
    HarmBlockThreshold,
} from "../gemini_sdk/index.ts"; // Adjusted path

// Common safety settings
export const defaultSafetySettings = [
    { category: "HARM_CATEGORY_HATE_SPEECH" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_HARASSMENT" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY" as HarmCategory, threshold: "OFF" as HarmBlockThreshold },
];

// Interface for route parameters (extracted from path or body)
export interface RouteHandlerParams {
    modelName?: string; // For actions on a specific model
    requestBody: any | null;
    sdkConfigOptions?: SdkConfigOptions; // Common config for generation/embedding
    // specific path params can be added if regex captures groups
    pathParams?: RegExpMatchArray | null;
}

// Route definition
export interface NativeRoute {
    pathPattern: RegExp;
    method: 'GET' | 'POST'; // Add other methods if needed
    handler: (apiKey: string, params: RouteHandlerParams) => Promise<Response>;
    requiresBody?: boolean;
    actionPath?: boolean; // Indicates if it's an action on a model (e.g., :generateContent)
}
