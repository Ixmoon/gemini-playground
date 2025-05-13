// Re-export handlers from their respective modules
export { handleOpenAIChatCompletion } from "./chat_handler.ts";
export { handleOpenAIEmbedding } from "./embedding_handler.ts";
export { handleOpenAIModelsList } from "./models_handler.ts";
export { handleOpenAIImageGeneration } from "./image_handler.ts"; // Added image handler

// Optionally, re-export types if they are needed
export type {
    OpenAIChatCompletionRequest,
    OpenAIEmbeddingRequest,
    OpenAIImageGenerationRequest, // Added image request type
    OpenAIImageGenerationResponse, // Added image response type
    OpenAIUsage,
    GeminiCandidate
} from "./types.ts";
