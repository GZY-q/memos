import { create } from "@bufbuild/protobuf";
import { aiServiceClient } from "@/connect";
import { CompleteRequestSchema } from "@/types/proto/api/v1/ai_service_pb";

export const writingService = {
  async complete(prompt: string, content: string): Promise<string> {
    const response = await aiServiceClient.complete(
      create(CompleteRequestSchema, {
        prompt,
        content,
      }),
    );
    return response.text;
  },
};
