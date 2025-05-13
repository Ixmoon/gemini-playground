import {
    embedSdxContent,
    EmbedContentRequest,
    EmbedConfig,
} from "../gemini_sdk/index.ts"; // Adjusted path
import {
    OpenAIEmbeddingRequest,
    OpenAIUsage
} from "./types.ts";

export async function handleOpenAIEmbedding(
    apiKey: string, openAIRequest: OpenAIEmbeddingRequest
): Promise<Response> {
    const inputs: string[] = Array.isArray(openAIRequest.input) ? openAIRequest.input : [openAIRequest.input];

    if (inputs.length === 0 || inputs.some(s => typeof s !== 'string' || s.trim() === "")) {
        return new Response(JSON.stringify({ error: { message: "Input must be a non-empty string or a non-empty array of non-empty strings."}}), {status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }});
    }

    const geminiModelName = openAIRequest.model;
    if (!geminiModelName) {
        return new Response(JSON.stringify({ error: { message: "Model name is required."}}), {status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }});
    }

    const openaiEmbeddings: any[] = [];
    let totalPromptTokens = 0; // Placeholder

    try {
        for (let i = 0; i < inputs.length; i++) {
            const inputText = inputs[i];
            const embedConfigForCall: EmbedConfig = {};
            if (openAIRequest.dimensions !== undefined) {
                embedConfigForCall.outputDimensionality = openAIRequest.dimensions;
            }

            const geminiCallParams: EmbedContentRequest = {
                model: geminiModelName,
                contents: [inputText], // CRITICAL: Must be an array of strings or Parts
                config: Object.keys(embedConfigForCall).length > 0 ? embedConfigForCall : undefined
            };
            if (geminiCallParams.config === undefined) delete geminiCallParams.config;

            const geminiResult = await embedSdxContent(apiKey, geminiCallParams);

            if (geminiResult.embeddings && geminiResult.embeddings.length > 0 && geminiResult.embeddings[0].values) {
                openaiEmbeddings.push({
                    object: "embedding",
                    embedding: geminiResult.embeddings[0].values,
                    index: i,
                });
            } else {
                console.warn(`Embedding failed or returned no vector for input at index ${i}: ${inputText}. Response from Gemini:`, JSON.stringify(geminiResult));
                openaiEmbeddings.push({
                    object: "embedding", embedding: [], index: i,
                    error: "Failed to generate embedding for this input."
                });
            }
            // totalPromptTokens += calculateTokens(inputText); // Placeholder
        }

        const openAIUsage: OpenAIUsage = { prompt_tokens: totalPromptTokens, total_tokens: totalPromptTokens, completion_tokens: 0 };
        const openAIResponse = {
            object: "list", data: openaiEmbeddings, model: openAIRequest.model, usage: openAIUsage,
        };
        return new Response(JSON.stringify(openAIResponse), { headers: { 'Content-Type': 'application/json; charset=utf-8' }});
    } catch (error) {
        const status = (error as any)?.status ?? 500;
        return new Response(JSON.stringify({ error: { message: (error as Error).message || "Embedding failed", type: (error as any)?.name || "gemini_error", code: status }}), { status, headers: { 'Content-Type': 'application/json' }});
    }
}
