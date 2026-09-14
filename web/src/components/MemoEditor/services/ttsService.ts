import { create } from "@bufbuild/protobuf";
import { aiServiceClient } from "@/connect";
import { SynthesizeRequestSchema } from "@/types/proto/api/v1/ai_service_pb";

export const ttsService = {
  async synthesize(text: string): Promise<{ audio: Uint8Array; contentType: string }> {
    const response = await aiServiceClient.synthesize(
      create(SynthesizeRequestSchema, {
        text,
      }),
    );
    return {
      audio: response.audio,
      contentType: response.contentType || "audio/mpeg",
    };
  },
};
