import {
    generateSdxContent,
    generateSdxContentStream,
    GenerateSdxContentParams,
    FunctionCallingConfigMode,
} from "../gemini_sdk/index.ts"; // Adjusted path
import {
    OpenAIChatCompletionRequest,
    GeminiCandidate,
    OpenAIUsage
} from "./types.ts";
import {
    transformOpenAIMessagesToGeminiContents,
    transformOpenAIConfigToSdkConfigOptions,
    generateOpenAIId,
    transformGeminiCandidateToOpenAIChoice,
    transformGeminiUsageToOpenAI
} from "./utils.ts";

export async function handleOpenAIChatCompletion(
    apiKey: string, openAIRequest: OpenAIChatCompletionRequest
): Promise<Response> {
    const { contents: geminiContents, systemInstruction } = await transformOpenAIMessagesToGeminiContents(openAIRequest.messages);
    const sdkConfigOptions = transformOpenAIConfigToSdkConfigOptions(openAIRequest);
    if (systemInstruction) sdkConfigOptions.systemInstruction = systemInstruction;

    if (openAIRequest.tools) {
        sdkConfigOptions.tools = openAIRequest.tools.map(tool => {
            if (tool.type === "function" && tool.function) {
                if (tool.function.name === "googleSearch") {
                    // Handle Google Search as a special built-in tool
                    return { googleSearch: {} };
                } else {
                    // Handle other functions as standard function declarations
                    // TODO: Implement proper JSON schema to Gemini schema conversion for parameters
                    const functionDeclaration = {
                        name: tool.function.name,
                        description: tool.function.description || "", // Default to empty string if not provided
                        parameters: tool.function.parameters // Pass as is for now, needs full conversion
                    };
                    return { functionDeclarations: [functionDeclaration] };
                }
            }
            // This case should ideally not be reached if OpenAI request is valid,
            // as 'tools' should be an array of 'function' type tools.
            // However, returning the tool as is might be a safe fallback, or throw an error.
            return tool;
        });
    }
    if (openAIRequest.tool_choice) {
        if (typeof openAIRequest.tool_choice === 'string') {
            const choiceStr = openAIRequest.tool_choice.toUpperCase();
            if (choiceStr === "AUTO" && "AUTO" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }};
            } else if (choiceStr === "ANY" && "ANY" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY }};
            } else if (choiceStr === "NONE" && "NONE" in FunctionCallingConfigMode) {
                 sdkConfigOptions.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE }};
            }
        } else if (typeof openAIRequest.tool_choice === 'object' && openAIRequest.tool_choice.type === 'function' && openAIRequest.tool_choice.function) {
             sdkConfigOptions.toolConfig = {
                functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [openAIRequest.tool_choice.function.name] }
            };
        }
    }

    const geminiParams: GenerateSdxContentParams = {
        model: openAIRequest.model, contents: geminiContents, config: sdkConfigOptions,
    };
    const id = generateOpenAIId();

    if (openAIRequest.stream) {
        try {
            const geminiStream = await generateSdxContentStream(apiKey, geminiParams);
            const readableStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    for await (const chunk of geminiStream) {
                        if (chunk.candidates && chunk.candidates.length > 0) {
                            const choice = transformGeminiCandidateToOpenAIChoice(chunk.candidates[0], 0, true);
                            const openAIStreamChunk: {id: string; object: string; created: number; model: string; choices: any[]; usage: OpenAIUsage | null} = {
                                id: id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
                                model: openAIRequest.model, choices: [choice], usage: null,
                            };
                            if (choice.finish_reason && chunk.usageMetadata) {
                                openAIStreamChunk.usage = transformGeminiUsageToOpenAI(chunk.usageMetadata);
                            }
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIStreamChunk)}\n\n`));
                        } else if (chunk.promptFeedback) console.warn("Gemini stream prompt feedback:", chunk.promptFeedback);
                    }
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                }
            });
            return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }});
        } catch (error) {
            console.error("Error during Gemini stream generation:", error);
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Stream failed", type: "gemini_error" }}), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
    } else {
    try {
            const geminiResult = await generateSdxContent(apiKey, geminiParams);
            const choices = geminiResult.candidates?.map((cand: GeminiCandidate, idx: number) => transformGeminiCandidateToOpenAIChoice(cand, idx, false)) || [];
            const openAIResponse = {
                id: id, object: "chat.completion", created: Math.floor(Date.now() / 1000),
                model: openAIRequest.model, choices: choices, usage: transformGeminiUsageToOpenAI(geminiResult.usageMetadata),
            };
            return new Response(JSON.stringify(openAIResponse), { headers: { 'Content-Type': 'application/json; charset=utf-8' }});
        } catch (error) {
            const status = (error as any)?.status ?? 500;
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Request failed", type: (error as any)?.name || "gemini_error", code: status }}), { status, headers: { 'Content-Type': 'application/json' }});
        }
    }
}
