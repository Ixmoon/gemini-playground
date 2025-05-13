import {
    listSdxModels,
    Model as SdkModel,
    RestListModelsResponse,
} from "../gemini_sdk/index.ts"; // Adjusted path

// New function to handle OpenAI /v1/models
export async function handleOpenAIModelsList(apiKey: string): Promise<Response> {
    try {
        const geminiModelsResponse: RestListModelsResponse = await listSdxModels(apiKey);
        const openAIModels = geminiModelsResponse.models
            .filter(model => typeof model.name === 'string' && model.name.length > 0)
            .map((model: SdkModel) => {
                const modelId = model.name!.startsWith("models/") ? model.name!.substring(7) : model.name!;
                return {
                    id: modelId,
                    object: "model" as "model",
                    created: Math.floor(Date.now() / 1000),
                    owned_by: "google" as "google",
                    permission: [],
                    root: modelId,
                    parent: null,
                };
            });

        return new Response(JSON.stringify({ object: "list", data: openAIModels }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } catch (error) {
        console.error("Error fetching or transforming model list for OpenAI:", error);
        const status = (error as any)?.status ?? 500;
        return new Response(JSON.stringify({ error: { message: (error as Error).message || "Failed to list models for OpenAI", type: "model_list_error", code: status }}), {
            status: status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}
