import {
    SdkGoogleGenAI,
    GenerateContentResponse,
    Content,
    Part,
    Modality,
    SdkConfigOptions,
    GenerateImageImagenParams,
    GenerateImageImagenResponse,
} from "./types.ts";

/**
 * Specific parameters for generating images with Gemini models.
 * Extends SdkConfigOptions to ensure responseModalities is set.
 */
export interface GenerateImageGeminiSdxConfig extends SdkConfigOptions {
    responseModalities: Modality[]; // Must include Modality.IMAGE
}

/**
 * Contents for Gemini image generation. Can be a simple text prompt
 * or an array of Parts for text & image to image.
 */
export type GeminiImageContents = string | Content[] | Part[];


export interface GenerateImageGeminiSdxParams {
    model: string; // e.g., "gemini-2.0-flash-preview-image-generation"
    contents: GeminiImageContents;
    config: GenerateImageGeminiSdxConfig; // Ensures responseModalities is correctly typed
}


/**
 * Generates image and potentially text using a Gemini model.
 * Handles both text-to-image and text & image-to-image.
 *
 * IMPORTANT: The 'config.responseModalities' must include Modality.IMAGE.
 * Gemini models always return text alongside an image if an image is generated.
 */
export async function generateSdxImageWithGemini(
    apiKey: string,
    params: GenerateImageGeminiSdxParams
): Promise<GenerateContentResponse> {
    const ai = new SdkGoogleGenAI({ apiKey });

    // Validate responseModalities
    if (!params.config.responseModalities.includes(Modality.IMAGE)) {
        throw new Error("Error in generateSdxImageWithGemini: params.config.responseModalities must include Modality.IMAGE.");
    }
    if (!params.config.responseModalities.includes(Modality.TEXT)) {
        // As per docs, Gemini always returns text with an image.
        // It's good practice to ensure TEXT modality is also requested.
        // If the SDK/API changes this behavior, this check might need adjustment.
        console.warn("generateSdxImageWithGemini: It's recommended to include Modality.TEXT in responseModalities as Gemini typically returns text with images.");
    }
    
    // The SDK's generateContent method expects 'contents' to be Content[]
    // We need to adapt our flexible GeminiImageContents type to Content[]
    let sdkContents: Content[];

    if (typeof params.contents === 'string') {
        sdkContents = [{ role: "user", parts: [{ text: params.contents }] }];
    } else if (Array.isArray(params.contents)) {
        // Assuming if it's an array, it's already Part[] or Content[] structure
        // If it's Part[], wrap it in a single "user" Content object
        // If it's Content[], use it directly
        if (params.contents.length > 0 && 'role' in params.contents[0] && 'parts' in params.contents[0]) {
             // Looks like Content[]
             sdkContents = params.contents as Content[];
        } else {
            // Assuming Part[]
            sdkContents = [{ role: "user", parts: params.contents as Part[] }];
        }
    } else {
        // This case should ideally not be hit if types are used correctly,
        // but as a fallback, treat as single text content.
        console.warn("generateSdxImageWithGemini: Unexpected contents format, attempting to treat as single text prompt.");
        sdkContents = [{ role: "user", parts: [{text: String(params.contents) }] }];
    }


    // The SDK's generateContent method expects generationConfig, safetySettings etc. at the top level
    // or within a general 'generationConfig' property based on the SDK's specific structure.
    // Our SdkConfigOptions / GenerateImageGeminiSdxConfig is a flat structure.
    // The error "Object literal may only specify known properties, and 'generationConfig' does not exist in type 'GenerateContentParameters'."
    // indicates that `generationConfig` is not a top-level property of `generateContent` parameters.
    // Instead, the properties within our `params.config` (like temperature, maxOutputTokens, responseModalities)
    // are expected to be part of the `generationConfig` object passed to `generateContent`.

    // Therefore, `params.config` itself should be the `generationConfig`.
    return ai.models.generateContent({
        model: params.model,
        contents: sdkContents,
        // Pass all properties from params.config as the generationConfig object
        // This assumes SdkConfigOptions (and by extension GenerateImageGeminiSdxConfig)
        // is compatible with the SDK's GenerationConfig type.
        config: params.config, 
    });
}

/**
 * Generates images using an Imagen model.
 *
 * IMPORTANT: Imagen models are typically for paid tiers and may have
 * restrictions (e.g., English-only prompts).
 */
export async function generateSdxImageWithImagen(
    apiKey: string,
    params: GenerateImageImagenParams
): Promise<GenerateImageImagenResponse> {
    const ai = new SdkGoogleGenAI({ apiKey });

    // The SDK has a dedicated `generateImages` method for Imagen.
    // The parameters are model, prompt, and an optional config object.
    // Similar to generateContent, the SDK's generateImages method likely expects
    // configuration options (like numberOfImages, aspectRatio) within a 'generationConfig' object.
    // The error "Object literal may only specify known properties, and 'generationConfig' does not exist in type 'GenerateImagesParameters'."
    // confirms that `generationConfig` is not a direct parameter of `generateImages`.
    // The `params.config` (type Imagen3Config) should be passed as the `generationConfig`.
    const sdkResponse = await ai.models.generateImages({
        model: params.model,
        prompt: params.prompt,
        config: params.config, 
    });

    // The SDK response for generateImages is expected to be:
    // { generatedImages: [{ image: { imageBytes: string } }, ...] }
    // This matches our GenerateImageImagenResponse structure.
    return sdkResponse as GenerateImageImagenResponse;
}
