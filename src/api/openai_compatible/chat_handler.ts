import {
    generateSdxContent,
    generateSdxContentStream,
    GenerateSdxContentParams,
    FunctionCallingConfigMode,
} from "../gemini_sdk/index.ts"; // Adjusted path
import {
    OpenAIChatCompletionRequest,
    GeminiCandidate,
} from "./types.ts";
import {
    iterableToReadableStream,
    GeminiToOpenAIStreamTransformer
} from "./stream_transformer.ts"; // Added import
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
    const sdkConfigOptions = transformOpenAIConfigToSdkConfigOptions(openAIRequest); // This now primarily handles generation config
    if (systemInstruction) sdkConfigOptions.systemInstruction = systemInstruction;

    // Handle tools and tool_choice separately to build SdkTool and SdkToolConfig
    if (openAIRequest.tools && openAIRequest.tools.length > 0) {
        const functionDeclarations = openAIRequest.tools
            .filter(tool => tool.type === "function" && tool.function)
            .map(tool => {
                // TODO: Implement proper JSON schema to Gemini schema conversion for parameters
                // For now, passing parameters as is, assuming they are compatible or will be handled by Gemini.
                // A more robust solution would involve a schema transformation utility.
                return {
                    name: tool.function.name,
                    description: tool.function.description || "",
                    parameters: tool.function.parameters,
                };
            });

        if (functionDeclarations.length > 0) {
            // Check for Google Search as a special tool
            const googleSearchTool = openAIRequest.tools.find(tool => tool.type === "function" && tool.function?.name === "googleSearch");
            if (googleSearchTool) {
                 sdkConfigOptions.tools = [{ googleSearch: {} }];
                 // If other function declarations exist alongside googleSearch, decide how to handle.
                 // Current Gemini SDK might prefer one type of tool in the array.
                 // For simplicity, if googleSearch is present, we prioritize it.
                 // Or, we can attempt to send both if the SDK supports [{googleSearch: {}}, {functionDeclarations: [...]}]
                 // Based on Gemini SDK, tools is an array that can contain a GoogleSearch OR FunctionDeclaration objects.
                 // It's not typically an array of objects with different tool types mixed at the top level of the array.
                 // So, if googleSearch is present, we might only send that, or send functionDeclarations if no googleSearch.
                 // Let's assume for now: if googleSearch is explicitly named, it's the primary tool.
                 // If other functions are also declared, they might be ignored by this simplified logic.
                 // A more advanced setup would require understanding how Gemini prioritizes/handles mixed tool types.
            } else {
                 sdkConfigOptions.tools = [{ functionDeclarations: functionDeclarations }];
            }
        }
    }

    if (openAIRequest.tool_choice) {
        if (typeof openAIRequest.tool_choice === 'string') {
            const choiceStr = openAIRequest.tool_choice.toUpperCase();
            let mode: FunctionCallingConfigMode | undefined = undefined;
            if (choiceStr === "AUTO") mode = FunctionCallingConfigMode.AUTO;
            else if (choiceStr === "ANY") mode = FunctionCallingConfigMode.ANY; // Or "REQUIRED" in OpenAI v1.1.0+ for a specific tool
            else if (choiceStr === "NONE") mode = FunctionCallingConfigMode.NONE;
            
            if (mode) {
                sdkConfigOptions.toolConfig = { functionCallingConfig: { mode } };
            }
        } else if (typeof openAIRequest.tool_choice === 'object' && openAIRequest.tool_choice.type === 'function' && openAIRequest.tool_choice.function?.name) {
            // This implies a specific function should be called.
            sdkConfigOptions.toolConfig = {
                functionCallingConfig: {
                    mode: FunctionCallingConfigMode.ANY, // ANY mode allows the model to choose from the provided list.
                                                       // If a specific function is forced, Gemini uses allowedFunctionNames.
                    allowedFunctionNames: [openAIRequest.tool_choice.function.name]
                }
            };
        }
    }


    const geminiParams: GenerateSdxContentParams = {
        model: openAIRequest.model,
        contents: geminiContents,
        config: sdkConfigOptions,
    };
    const id = generateOpenAIId();

    if (openAIRequest.stream) {
        try {
            const geminiStreamIterable = await generateSdxContentStream(apiKey, geminiParams);
            const geminiReadableStream = iterableToReadableStream(geminiStreamIterable);
            
            const streamOptions = {
                ...(openAIRequest.stream_options || {}),
                include_usage: true // Force include_usage to true
            };
            const transformer = new GeminiToOpenAIStreamTransformer(
                id,
                openAIRequest.model,
                streamOptions
            );

            const openAIStream = geminiReadableStream
                .pipeThrough(new TransformStream(transformer))
                .pipeThrough(new TextEncoderStream());

            return new Response(openAIStream, { 
                headers: { 
                    'Content-Type': 'text/event-stream; charset=utf-8', 
                    'Cache-Control': 'no-cache', 
                    'Connection': 'keep-alive' 
                }
            });
        } catch (error) {
            console.error("Error during Gemini stream generation:", error);
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Stream failed", type: "gemini_error" }}), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
    } else {
    try {
            const geminiResult = await generateSdxContent(apiKey, geminiParams);
            const choices = geminiResult.candidates?.map((cand: GeminiCandidate, idx: number) => transformGeminiCandidateToOpenAIChoice(cand, idx, false)) || [];
            const openAIResponse = {
                id: id,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: openAIRequest.model,
                choices: choices,
                usage: transformGeminiUsageToOpenAI(geminiResult.usageMetadata),
                reasoning: { // Added reasoning to the response
                    effort: openAIRequest.reasoning?.effort || null,
                    summary: null // Gemini SDK does not currently provide a reasoning summary
                }
            };
            return new Response(JSON.stringify(openAIResponse), { headers: { 'Content-Type': 'application/json; charset=utf-8' }});
        } catch (error) {
            const status = (error as any)?.status ?? 500;
            return new Response(JSON.stringify({ error: { message: (error as Error).message || "Request failed", type: (error as any)?.name || "gemini_error", code: status }}), { status, headers: { 'Content-Type': 'application/json' }});
        }
    }
}
