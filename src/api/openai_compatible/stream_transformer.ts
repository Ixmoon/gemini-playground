import { GenerateContentResponse } from "../gemini_sdk/index.ts";
import { OpenAIUsage } from "./types.ts";
import {
    transformGeminiCandidateToOpenAIChoice,
    transformGeminiUsageToOpenAI
} from "./utils.ts";

// Helper to convert an AsyncIterable into a ReadableStream
export function iterableToReadableStream<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        console.error("Error in iterableToReadableStream pull:", err);
        controller.error(err);
      }
    },
    async cancel(reason) {
      if (typeof iterator.return === 'function') {
        try {
          await iterator.return(reason);
        } catch (err) {
          console.error("Error in iterableToReadableStream cancel:", err);
        }
      }
    }
  });
}

export class GeminiToOpenAIStreamTransformer implements Transformer<GenerateContentResponse, string> {
    private id: string;
    private model: string;
    private streamOptions?: { include_usage?: boolean };
    
    private isFirstContentChunkByChoiceIndex: Record<number, boolean> = {};
    private finalUsageData: OpenAIUsage | null = null;
    private accumulatedFinishReasonByChoiceIndex: Record<number, string | null> = {};

    constructor(id: string, model: string, streamOptions?: { include_usage?: boolean }) {
        this.id = id;
        this.model = model;
        this.streamOptions = streamOptions;
    }

    transform(geminiChunk: GenerateContentResponse, controller: TransformStreamDefaultController<string>) {
        const now = Math.floor(Date.now() / 1000);

        if (geminiChunk.candidates && geminiChunk.candidates.length > 0) {
            for (let i = 0; i < geminiChunk.candidates.length; i++) {
                const candidate = geminiChunk.candidates[i];
                // Ensure isFirstContentChunkByChoiceIndex is initialized for this index
                if (this.isFirstContentChunkByChoiceIndex[i] === undefined) {
                    this.isFirstContentChunkByChoiceIndex[i] = true;
                }

                const choice = transformGeminiCandidateToOpenAIChoice(candidate, i, true);

                if (this.isFirstContentChunkByChoiceIndex[i] && (choice.delta.content || choice.delta.tool_calls)) {
                    const firstChunkOpenAI = {
                        id: this.id,
                        object: "chat.completion.chunk",
                        created: now,
                        model: this.model,
                        choices: [{
                            index: i,
                            delta: { role: "assistant" },
                            finish_reason: null,
                        }],
                    };
                    controller.enqueue(`data: ${JSON.stringify(firstChunkOpenAI)}\n\n`);
                    this.isFirstContentChunkByChoiceIndex[i] = false;
                }

                const currentDelta = choice.delta;
                if (currentDelta.role || currentDelta.content || currentDelta.tool_calls) {
                    const openAIStreamChunkPayload: any = {
                        id: this.id,
                        object: "chat.completion.chunk",
                        created: now,
                        model: this.model,
                        choices: [{
                            index: i,
                            delta: currentDelta,
                            finish_reason: choice.finish_reason 
                        }],
                    };

                    // If this chunk has a finish reason and usage should be included,
                    // and we have usage metadata from this Gemini chunk, attach it.
                    if (choice.finish_reason && geminiChunk.usageMetadata && this.streamOptions?.include_usage) {
                        openAIStreamChunkPayload.usage = transformGeminiUsageToOpenAI(geminiChunk.usageMetadata);
                        // Mark finalUsageData as handled for this specific stream if it's attached here.
                        // This assumes usageMetadata applies to all candidates in this chunk.
                        this.finalUsageData = null; 
                    }
                    controller.enqueue(`data: ${JSON.stringify(openAIStreamChunkPayload)}\n\n`);
                }
                
                if (choice.finish_reason) {
                    this.accumulatedFinishReasonByChoiceIndex[i] = choice.finish_reason;
                }
            }
            // If usageMetadata arrived with this chunk but wasn't attached to a choice (e.g., no finish_reason yet)
            // store it for the flush method, but only if it hasn't been nulled out (sent with a choice).
            if (geminiChunk.usageMetadata && this.finalUsageData !== null) { 
                this.finalUsageData = transformGeminiUsageToOpenAI(geminiChunk.usageMetadata);
            }

        } else if (geminiChunk.promptFeedback) {
            console.warn("Gemini stream prompt feedback:", geminiChunk.promptFeedback);
            let finishReason = "error"; // Default error reason
            if (geminiChunk.promptFeedback.blockReason) {
                finishReason = "content_filter"; // More specific
            }
            // Assume prompt feedback applies to choice index 0 if no candidates
            const errorChoice = {
                index: 0,
                delta: {},
                finish_reason: finishReason,
            };
            const errorChunk = {
                id: this.id, object: "chat.completion.chunk", created: now,
                model: this.model, choices: [errorChoice],
            };
            controller.enqueue(`data: ${JSON.stringify(errorChunk)}\n\n`);
            this.accumulatedFinishReasonByChoiceIndex[0] = finishReason;
            this.isFirstContentChunkByChoiceIndex[0] = false; // Mark as handled
        }
    }

    flush(controller: TransformStreamDefaultController<string>) {
        const now = Math.floor(Date.now() / 1000);

        // Send a final chunk if include_usage is true and we have pending usage data
        if (this.streamOptions?.include_usage && this.finalUsageData) {
            const usageChunk = {
                id: this.id,
                object: "chat.completion.chunk",
                created: now,
                model: this.model,
                choices: [], 
                usage: this.finalUsageData,
            };
            controller.enqueue(`data: ${JSON.stringify(usageChunk)}\n\n`);
        }

        // If no content was ever streamed for some choices (e.g. immediate prompt block)
        // but a finish reason was determined.
        // This needs to check all possible choice indices that might have been initialized.
        Object.keys(this.isFirstContentChunkByChoiceIndex).forEach(key => {
            const index = parseInt(key, 10);
            if (this.isFirstContentChunkByChoiceIndex[index] && this.accumulatedFinishReasonByChoiceIndex[index]) {
                const emptyContentFinalChunk = {
                    id: this.id,
                    object: "chat.completion.chunk",
                    created: now,
                    model: this.model,
                    choices: [{
                        index: index,
                        delta: { role: "assistant" },
                        finish_reason: this.accumulatedFinishReasonByChoiceIndex[index],
                    }],
                    // Conditionally add usage if available and not sent
                    usage: (this.streamOptions?.include_usage && this.finalUsageData) ? this.finalUsageData : undefined,
                };
                if (!emptyContentFinalChunk.usage) delete emptyContentFinalChunk.usage;
                controller.enqueue(`data: ${JSON.stringify(emptyContentFinalChunk)}\n\n`);
            }
        });

        controller.enqueue("data: [DONE]\n\n");
    }
}
