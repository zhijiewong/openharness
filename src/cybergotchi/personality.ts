import type { Provider } from "../providers/base.js";
import { createUserMessage } from "../types/message.js";
import type { CompanionBones } from "./types.js";

/**
 * Generate a name and personality description for a companion using the LLM.
 * Returns { name, personality } or null if generation fails.
 */
export async function generatePersonality(
  provider: Provider,
  bones: CompanionBones,
  model?: string,
): Promise<{ name: string; personality: string } | null> {
  const prompt = `Generate a name and 2-sentence personality for a ${bones.species} coding companion with these traits: DEBUGGING:${bones.baseStats.DEBUGGING}, PATIENCE:${bones.baseStats.PATIENCE}, CHAOS:${bones.baseStats.CHAOS}, WISDOM:${bones.baseStats.WISDOM}, SNARK:${bones.baseStats.SNARK}. Rarity: ${bones.rarity}. Keep it fun and concise. Respond in JSON format: {"name": "...", "personality": "..."}`;

  try {
    const messages = [createUserMessage(prompt)];
    const response = await provider.complete(
      messages,
      "You are a creative naming assistant. Respond only with the requested JSON.",
      undefined,
      model,
    );

    const text = response.content.trim();
    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.name && parsed.personality) {
        return { name: String(parsed.name), personality: String(parsed.personality) };
      }
    }
    return null;
  } catch {
    return null;
  }
}
