import {
    SdkGoogleGenAI,
    EmbedContentRequest,
    EmbedContentResponse,
    BatchEmbedContentsRequest,
    BatchEmbedContentsResponse,
    Part,
    Content, // Added Content for type checking in batchEmbedSdxContents
} from "./types.ts";

export async function embedSdxContent(
    apiKey: string,
    params: EmbedContentRequest
): Promise<EmbedContentResponse> {
    const ai = new SdkGoogleGenAI({ apiKey });
    // ai.models.embedContent directly returns the desired structure { embeddings: [] }
    return await ai.models.embedContent(params) as EmbedContentResponse;
}

// Optimized batch embedding assuming all sub-requests share the same model and configuration.
export async function batchEmbedSdxContents(
    apiKey: string,
    params: BatchEmbedContentsRequest
): Promise<BatchEmbedContentsResponse> {
    if (!params.model) {
        throw new Error("Global model must be specified in BatchEmbedContentsRequest for optimized batching.");
    }
    if (!params.requests || params.requests.length === 0) {
        return { embeddings: [] }; // Return empty if no requests
    }

    // Assuming all items share the same model and configuration.
    // We'll use the global model and the configuration from the first item (if any).
    const sharedModel = params.model;
    const firstRequestItem = params.requests[0];
    const sharedTaskType = firstRequestItem?.taskType;
    const sharedTitle = firstRequestItem?.title;
    const sharedEmbedConfig = firstRequestItem?.config;

    const allContents: (string | Part)[] = [];

    for (const item of params.requests) {
        // Optional: Add a check here if strict config sharing is required.
        // For example, if item.model exists and differs from sharedModel, throw an error.
        // if (item.model && item.model !== sharedModel) {
        //     throw new Error("All items in batch must share the same model for optimized batching.");
        // }
        // Similarly for taskType, title, config.

        let itemProcessedContents: (string | Part)[];
        if (typeof item.contents === 'string') {
            itemProcessedContents = [item.contents];
        } else if (item.contents && typeof item.contents === 'object') {
            // Assert item.contents is a Content object
            const contentObject = item.contents as Content;
            if (Array.isArray(contentObject.parts)) {
                // contentObject.parts is Part[], which is assignable to (string | Part)[]
                itemProcessedContents = contentObject.parts;
            } else {
                // This case should ideally not be reached if Content type guarantees 'parts' is an array.
                // If 'parts' could be undefined on Content, this path would need handling.
                throw new Error(`Invalid item.contents: 'parts' field is missing or not an array.`);
            }
        } else {
            throw new Error(`Invalid item.contents structure for item. Expected string or Content object.`);
        }
        allContents.push(...itemProcessedContents);
    }

    if (allContents.length === 0) {
        return { embeddings: [] };
    }

    const batchCallParams: EmbedContentRequest = {
        model: sharedModel,
        contents: allContents,
        taskType: sharedTaskType,
        title: sharedTitle,
        config: sharedEmbedConfig,
    };

    // Clean up undefined optional properties
    if (batchCallParams.taskType === undefined) delete batchCallParams.taskType;
    if (batchCallParams.title === undefined) delete batchCallParams.title;
    if (batchCallParams.config === undefined) delete batchCallParams.config;

    // Call embedSdxContent once with all contents
    // The response is already in BatchEmbedContentsResponse format { embeddings: ContentEmbedding[] }
    return embedSdxContent(apiKey, batchCallParams);
}
