import { Box, Text, useInput } from "ink";
import TextInputLib from "ink-text-input";
import { useMemo, useState } from "react";
import { getDefaultSeed, roll } from "../cybergotchi/bones.js";
import { createCompanionConfig, saveCompanionConfig } from "../cybergotchi/config.js";
import { SPECIES } from "../cybergotchi/species.js";
import type { CompanionBones, CompanionConfig } from "../cybergotchi/types.js";
import { HAT_ART, RARITY_COLORS, RARITY_HATS, RARITY_STARS } from "../cybergotchi/types.js";
import CybergotchiSprite from "./CybergotchiSprite.js";

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

type Step = "seed" | "reveal" | "name" | "hat";

export default function CybergotchiSetup({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState<Step>("seed");
  const [seed, setSeed] = useState(getDefaultSeed());
  const [name, setName] = useState("");
  const [hatIdx, setHatIdx] = useState(0);

  // Compute bones from current seed
  const bones: CompanionBones = useMemo(() => roll(seed), [seed]);
  const species = SPECIES.find((s) => s.name === bones.species)!;
  const availableHats = RARITY_HATS[bones.rarity];

  // Build a preview config for the sprite
  const previewConfig: CompanionConfig = useMemo(
    () => createCompanionConfig(seed, name || species.label, "", availableHats[hatIdx] ?? "none"),
    [seed, name, species.label, hatIdx, availableHats],
  );

  const previewState = { emotion: "idle" as const, frame: 0, speech: null, speechTtl: 0 };

  useInput((_input, key) => {
    if (key.escape) {
      onSkip();
      return;
    }

    if (step === "seed") {
      // Seed is edited via TextInput; Enter advances
    } else if (step === "reveal") {
      if (key.return) setStep("name");
    } else if (step === "name") {
      // Name is edited via TextInput; Enter advances
    } else if (step === "hat") {
      if (key.upArrow) setHatIdx((i) => (i - 1 + availableHats.length) % availableHats.length);
      if (key.downArrow) setHatIdx((i) => (i + 1) % availableHats.length);
      if (key.return) {
        const cfg = createCompanionConfig(
          seed,
          name || species.label,
          "", // personality — filled by LLM later
          availableHats[hatIdx] ?? "none",
        );
        saveCompanionConfig(cfg);
        onComplete();
      }
    }
  });

  return (
    <Box flexDirection="row" gap={2}>
      {/* Left: wizard */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="magenta">
          ◆ Companion Setup
        </Text>
        <Text dimColor>Esc to skip</Text>
        <Text> </Text>

        {step === "seed" && (
          <Box flexDirection="column">
            <Text bold>Enter a seed phrase:</Text>
            <Text dimColor>This determines your species, rarity, and stats.</Text>
            <Text dimColor>Same seed = same companion. Press Enter to continue.</Text>
            <Text> </Text>
            <Box>
              <Text color="cyan">{"❯ "}</Text>
              <TextInputLib
                value={seed}
                onChange={setSeed}
                onSubmit={() => setStep("reveal")}
                placeholder={getDefaultSeed()}
              />
            </Box>
          </Box>
        )}

        {step === "reveal" && (
          <Box flexDirection="column">
            <Text bold>Your companion has been determined!</Text>
            <Text> </Text>
            <Text>
              Species:{" "}
              <Text color={RARITY_COLORS[bones.rarity]} bold>
                {species.label}
              </Text>
            </Text>
            <Text>
              Rarity:{" "}
              <Text color={RARITY_COLORS[bones.rarity]}>
                {bones.rarity} {RARITY_STARS[bones.rarity]}
              </Text>
            </Text>
            {bones.isShiny && (
              <Text color="yellow" bold>
                ✨ SHINY! ✨
              </Text>
            )}
            <Text> </Text>
            <Text dimColor>Stats:</Text>
            <Text> DEBUGGING: {bones.baseStats.DEBUGGING}</Text>
            <Text> PATIENCE: {bones.baseStats.PATIENCE}</Text>
            <Text> CHAOS: {bones.baseStats.CHAOS}</Text>
            <Text> WISDOM: {bones.baseStats.WISDOM}</Text>
            <Text> SNARK: {bones.baseStats.SNARK}</Text>
            <Text> </Text>
            <Text dimColor>{species.traitHint}</Text>
            <Text> </Text>
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        )}

        {step === "name" && (
          <Box flexDirection="column">
            <Text bold>Name your companion:</Text>
            <Text dimColor>Enter to continue</Text>
            <Text> </Text>
            <Box>
              <Text color="cyan">{"❯ "}</Text>
              <TextInputLib
                value={name}
                onChange={setName}
                onSubmit={() => {
                  setStep("hat");
                }}
                placeholder={species.label}
              />
            </Box>
          </Box>
        )}

        {step === "hat" && (
          <Box flexDirection="column">
            <Text bold>Choose a hat:</Text>
            <Text dimColor>↑↓ to browse · Enter to finish</Text>
            {bones.rarity === "common" && <Text dimColor>More hats unlock at higher rarities!</Text>}
            <Text> </Text>
            {availableHats.map((h, i) => (
              <Text key={h} color={i === hatIdx ? "cyan" : undefined}>
                {i === hatIdx ? "▶ " : "  "}
                {h}
                {h !== "none" && HAT_ART[h] ? ` ${HAT_ART[h]}` : ""}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {/* Right: live preview */}
      <Box flexDirection="column" width={16} borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" dimColor>
          Preview
        </Text>
        <CybergotchiSprite bones={bones} config={previewConfig} state={previewState} />
        <Text color={RARITY_COLORS[bones.rarity]} dimColor>
          {name || species.label} {RARITY_STARS[bones.rarity]}
        </Text>
      </Box>
    </Box>
  );
}
