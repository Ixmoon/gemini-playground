import {
    generateSdxImageWithGemini,
    generateSdxImageWithImagen,
    GenerateImageGeminiSdxParams,
    GenerateImageImagenParams,
    Modality,
    Content,
    Part,
    GenerateContentResponse, // For Gemini response
    GenerateImageImagenResponse as SdkImagenResponse // For Imagen response
} from "../gemini_sdk/index.ts";
import {
    OpenAIImageGenerationRequest,
    OpenAIImageGenerationResponse,
    OpenAIImageDataBase64,
    OpenAIUsage // Import OpenAIUsage type
} from "./types.ts";
import { transformGeminiUsageToOpenAI } from "./utils.ts"; // Import the transformation function

// Helper to decide which SDK function to call based on model or other params.
// For now, assumes a simple model name check.
// A more sophisticated approach might involve checking model capabilities.
function shouldUseImagen(modelName?: string): boolean {
    if (modelName && modelName.toLowerCase().includes("imagen")) {
        return true;
    }
    // Default to Gemini for image generation if not specified or not recognized as Imagen
    return false;
}

export async function handleOpenAIImageGeneration(
    apiKey: string,
    openAIRequest: OpenAIImageGenerationRequest
): Promise<Response> {
    const modelToUse = openAIRequest.model || "gemini-2.0-flash-preview-image-generation"; // Default to a Gemini image model
    const responseFormat = openAIRequest.response_format || "b64_json"; // Default to b64_json

    if (responseFormat === "url") {
        return new Response(JSON.stringify({ error: { message: "Response format 'url' is not supported. Please use 'b64_json'." } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    const imageData: OpenAIImageDataBase64[] = [];
    let usageData: OpenAIUsage | undefined = undefined; // Declare usageData here

    try {
        if (shouldUseImagen(modelToUse)) {
            // --- Call Imagen ---
            const imagenParams: GenerateImageImagenParams = {
                model: modelToUse,
                prompt: openAIRequest.prompt,
                config: {
                    numberOfImages: openAIRequest.n,
                    // aspectRatio: openAIRequest.size ? mapOpenAISizeToAspectRatio(openAIRequest.size) : undefined, // TODO: map size
                    // personGeneration: undefined, // TODO: map if applicable from OpenAI request
                }
            };
            if (!imagenParams.config?.numberOfImages) delete imagenParams.config?.numberOfImages;
            // Add more config mapping if needed

            const imagenResult: SdkImagenResponse = await generateSdxImageWithImagen(apiKey, imagenParams);
            
            if (imagenResult.generatedImages && imagenResult.generatedImages.length > 0) {
                imagenResult.generatedImages.forEach(img => {
                    imageData.push({ b64_json: img.image.imageBytes });
                });
            } else {
                throw new Error("Imagen generation did not return any images.");
            }

        } else {
            // --- Call Gemini ---
            const contents: Content[] = [{ role: "user", parts: [{ text: openAIRequest.prompt }] }];
            
            // For Gemini, 'n' (number of images) is controlled by candidateCount.
            // However, Gemini image generation typically returns one image per call alongside text.
            // If n > 1, we might need to make multiple calls or acknowledge this limitation.
            // For now, we assume n=1 or SDK handles candidateCount for images.
            // The SdkConfigOptions from chat_handler might be a good base if we adapt it.
            // For simplicity, let's construct a minimal config here.
            
            const geminiParams: GenerateImageGeminiSdxParams = {
                model: modelToUse,
                contents: contents,
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT], // Gemini requires TEXT with IMAGE
                    candidateCount: openAIRequest.n || 1, // Map 'n' to candidateCount
                    // temperature: openAIRequest.temperature, // If applicable and supported
                    // topP: openAIRequest.top_p, // If applicable
                    // topK: openAIRequest.top_k, // If applicable
                }
            };
             if (openAIRequest.size) {
                // Gemini doesn't use 'size' like DALL-E. It might use aspectRatio.
                // This needs a mapping if we want to support 'size' meaningfully.
                // console.warn("OpenAI 'size' parameter is not directly supported by Gemini image generation. Aspect ratio might be an alternative if supported by the model.");
            }


            const geminiResult: GenerateContentResponse = await generateSdxImageWithGemini(apiKey, geminiParams);

            if (geminiResult.candidates && geminiResult.candidates.length > 0) {
                // Assuming each candidate might produce one image and associated text.
                // If openAIRequest.n > 1 leads to multiple candidates, process each.
                for (const candidate of geminiResult.candidates) {
                    let imageBase64: string | undefined = undefined;
                    let revisedPromptText: string | undefined = undefined;
                    if (candidate.content && candidate.content.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.inlineData && part.inlineData.data) {
                                imageBase64 = part.inlineData.data;
                            }
                            if (part.text) {
                                revisedPromptText = (revisedPromptText || "") + part.text + " ";
                            }
                        }
                    }
                    if (imageBase64) {
                        const imageEntry: OpenAIImageDataBase64 = { b64_json: imageBase64 };
                        if (revisedPromptText) {
                            imageEntry.revised_prompt = revisedPromptText.trim();
                        }
                        imageData.push(imageEntry);
                    }
                }
                if (imageData.length === 0) {
                    // If no image was found in any candidate, but there might be text.
                    let fallbackText = "";
                    geminiResult.candidates.forEach(c => c.content?.parts?.forEach(p => { if(p.text) fallbackText += p.text + " "; }));
                    if (fallbackText.trim()) {
                         throw new Error(`Gemini generation did not return any image data, but returned text: ${fallbackText.trim()}`);
                    } else {
                        throw new Error("Gemini generation did not return any image data or text.");
                    }
                }
            } else {
                // Check for promptFeedback if no candidates
                let feedbackMessage = "Gemini generation did not return any candidates.";
                if (geminiResult.promptFeedback) {
                    feedbackMessage += ` Prompt Feedback: ${JSON.stringify(geminiResult.promptFeedback)}`;
                }
                throw new Error(feedbackMessage);
            }

            // Add usage data if available from Gemini
            if (geminiResult.usageMetadata) {
                 usageData = transformGeminiUsageToOpenAI(geminiResult.usageMetadata);
            }
        }

        const openAIResponse: OpenAIImageGenerationResponse = {
            created: Math.floor(Date.now() / 1000),
            data: imageData,
        };

        // Add usage data to the final response if collected
        if (usageData) {
            openAIResponse.usage = usageData;
        }


        return new Response(JSON.stringify(openAIResponse), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });

    } catch (error) {
        console.error(`Error in handleOpenAIImageGeneration for model ${modelToUse}:`, error);
        // TODO: Handle specific API errors (e.g., rate limits, invalid requests) and map to appropriate OpenAI error format and status codes.
        const status = (error as any)?.status ?? 500;
        return new Response(JSON.stringify({ error: { message: (error as Error).message, type: "image_generation_error", code: status } }), {
            status: status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}
