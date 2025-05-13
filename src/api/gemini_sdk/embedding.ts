import {
    SdkGoogleGenAI,
    EmbedContentRequest,
    EmbedContentResponse,
    BatchEmbedContentsRequest,
    BatchEmbedContentsResponse,
    ContentEmbedding,
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

// Simulating batch embedding by iterating single embedding calls
export async function batchEmbedSdxContents(
    apiKey: string,
    params: BatchEmbedContentsRequest
): Promise<BatchEmbedContentsResponse> {
    const allEmbeddings: ContentEmbedding[] = [];

    for (const item of params.requests) {
        const itemModel = item.model || params.model;
        if (!itemModel) {
            throw new Error("Model must be specified either in batch request or in each item request.");
        }
        // Prepare params for the single embedSdxContent call
        // Ensure 'contents' passed to embedSdxContent is (string | Part)[]
        let processedItemContents: (string | Part)[];



        if (typeof item.contents === 'string') {
            processedItemContents = [item.contents];
        } else if (item.contents && typeof item.contents === 'object' && (item.contents as Content).parts) {
            // Now we know item.contents is an object and has a 'parts' property.
            // Let's verify 'parts' is an array before using it.
            const partsArray = (item.contents as Content).parts;
            if (Array.isArray(partsArray)) {
                const texts: string[] = partsArray.reduce((acc: string[], part: Part) => {
                    if (part.text) {
                        acc.push(part.text);
                    }
                    return acc;
                }, []);
                if (texts.length === 0) {
                    throw new Error(`Item content for model ${itemModel} (Content object) has no text parts for embedding.`);
                }
                processedItemContents = texts;
            } else {
                throw new Error(`Invalid item.contents.parts structure for model ${itemModel}. Expected 'parts' to be an array.`);
            }
        } else {
            throw new Error(`Invalid item.contents structure for model ${itemModel}. Expected string or Content object with a 'parts' array containing text.`);
        }

        const singleEmbedCallParams: EmbedContentRequest = {
            model: itemModel,
            contents: processedItemContents, // This is now (string | Part)[]
            taskType: item.taskType,
            title: item.title,
            config: item.config,
        };

        try {
            const response = await embedSdxContent(apiKey, singleEmbedCallParams);
            if (response.embeddings && response.embeddings.length > 0) {
                // If multiple strings were in processedItemContents, embedContent might return multiple embeddings.
                // For now, assuming one primary embedding result if only one string was effectively passed.
                // If our simulated batch is item-per-item, then `response.embeddings[0]` is correct for that item.
                allEmbeddings.push(response.embeddings[0]);
            } else {
                console.warn(`embedSdxContent for model ${itemModel} returned no embeddings for an item.`);
                throw new Error(`Embedding for item with model ${itemModel} yielded an empty/null embeddings array.`);
            }
        } catch (error) {
            // The error from API "Value must be a list given an array path requests[]" might be caught here.
            // Let's log the params that caused it for better debugging.
            console.error(`Error embedding content for item (model: ${itemModel}) with params: ${JSON.stringify(singleEmbedCallParams)}`, error);
            throw new Error(`Failed to embed content for one of the items in batch (model ${itemModel}): ${(error as Error).message}`);
        }
    }
    return { embeddings: allEmbeddings };
}
