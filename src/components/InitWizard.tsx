/**
 * oh init — full TUI wizard for provider setup + cybergotchi hatch.
 *
 * Steps:
 *  1. Provider selection
 *  2. API key entry (skipped for Ollama)
 *  3. Connection test
 *  4. Model selection
 *  5. Permission mode
 *  6. Cybergotchi hatch (Y/n)
 *  7. Summary + write .oh/config.yaml
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { writeOhConfig } from "../harness/config.js";
import CybergotchiSetup from "./CybergotchiSetup.js";

// ── Types ──

type Provider = {
  key: string;
  label: string;
  defaultModel: string;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
};

const PROVIDERS: Provider[] = [
  { key: "ollama",     label: "Ollama (local, free)",      defaultModel: "llama3",           needsApiKey: false, defaultBaseUrl: "http://localhost:11434" },
  { key: "openai",     label: "OpenAI",                    defaultModel: "gpt-4o",           needsApiKey: true  },
  { key: "anthropic",  label: "Anthropic (Claude)",        defaultModel: "claude-sonnet-4-6",needsApiKey: true  },
  { key: "openrouter", label: "OpenRouter",                defaultModel: "openai/gpt-4o",    needsApiKey: true,  defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { key: "custom",     label: "Custom (OpenAI-compatible)",defaultModel: "",                 needsApiKey: true  },
];

const PERMISSION_MODES = [
  { key: "ask",   label: "ask   — prompt before each tool call (recommended)" },
  { key: "trust", label: "trust — auto-approve everything" },
  { key: "deny",  label: "deny  — read-only, block write/run tools" },
];

type Step = "provider" | "apikey" | "baseurl" | "testing" | "model" | "permission" | "gotchi" | "done";

// ── Component ──

interface Props {
  onDone?: () => void;
}

export default function InitWizard({ onDone }: Props) {
  const [step, setStep] = useState<Step>("provider");
  const [providerIdx, setProviderIdx] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [modelIdx, setModelIdx] = useState(0);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<"testing" | "ok" | "fail">("testing");
  const [testError, setTestError] = useState("");
  const [permIdx, setPermIdx] = useState(0);
  const [hatchGotchi, setHatchGotchi] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const provider = PROVIDERS[providerIdx]!;

  // ── Keyboard navigation ──

  useInput(useCallback((input, key) => {
    if (step === "provider") {
      if (key.upArrow) setProviderIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1));
      if (key.return) {
        setBaseUrl(provider.defaultBaseUrl ?? "");
        setModel(provider.defaultModel);
        if (!provider.needsApiKey) {
          // Skip API key, go straight to testing
          runTest(provider, "", provider.defaultBaseUrl ?? "");
          setStep("testing");
        } else {
          setStep("apikey");
        }
      }
    }

    if (step === "permission") {
      if (key.upArrow) setPermIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setPermIdx(i => Math.min(PERMISSION_MODES.length - 1, i + 1));
      if (key.return) setStep("gotchi");
    }

    if (step === "model" && availableModels.length > 0) {
      if (key.upArrow) setModelIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setModelIdx(i => Math.min(availableModels.length - 1, i + 1));
      if (key.return) {
        setModel(availableModels[modelIdx] ?? model);
        setStep("permission");
      }
    }

    if (step === "gotchi") {
      if (input === "y" || input === "Y" || key.return) { setHatchGotchi(true); setShowSetup(true); }
      if (input === "n" || input === "N") writeFinal();
    }
  }, [step, providerIdx, provider, modelIdx, availableModels, model]));

  // ── Connection test ──

  const runTest = async (prov: Provider, key: string, url: string) => {
    setTestStatus("testing");
    try {
      const { createProviderInstance } = await import("../providers/index.js");
      const p = createProviderInstance(prov.key, {
        name: prov.key,
        apiKey: key || process.env[`${prov.key.toUpperCase()}_API_KEY`],
        baseUrl: url || prov.defaultBaseUrl,
        defaultModel: prov.defaultModel,
      });
      const fetched = "fetchModels" in p && typeof (p as any).fetchModels === "function"
        ? await (p as any).fetchModels()
        : p.listModels();
      const modelNames = fetched.map((m: any) => m.id as string);
      setAvailableModels(modelNames.length > 0 ? modelNames : [prov.defaultModel]);
      setTestStatus("ok");
      setTimeout(() => setStep("model"), 600);
    } catch (err) {
      setTestStatus("fail");
      setTestError(err instanceof Error ? err.message : String(err));
      setAvailableModels([prov.defaultModel]);
      setTimeout(() => setStep("model"), 800);
    }
  };

  // ── Write final config ──

  const writeFinal = useCallback(() => {
    const selectedModel = availableModels.length > 0 ? (availableModels[modelIdx] ?? model) : model;
    writeOhConfig({
      provider: provider.key,
      model: selectedModel || provider.defaultModel,
      permissionMode: PERMISSION_MODES[permIdx]!.key as any,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
    setStep("done");
    setTimeout(() => onDone?.(), 1500);
  }, [provider, model, availableModels, modelIdx, permIdx, apiKey, baseUrl]);

  // ── Render ──

  if (showSetup) {
    return <CybergotchiSetup onComplete={() => { setShowSetup(false); writeFinal(); }} onSkip={() => { setShowSetup(false); writeFinal(); }} />;
  }

  if (step === "done") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">✓ OpenHarness configured!</Text>
        <Text dimColor>Config saved to .oh/config.yaml</Text>
        <Text dimColor>Run: oh</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">OpenHarness Setup</Text>
      <Text> </Text>

      {step === "provider" && (
        <Box flexDirection="column">
          <Text>Select provider:</Text>
          {PROVIDERS.map((p, i) => (
            <Text key={p.key} color={i === providerIdx ? "cyan" : undefined}>
              {i === providerIdx ? "▶ " : "  "}{p.label}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>↑↓ navigate  Enter select</Text>
        </Box>
      )}

      {step === "apikey" && (
        <Box flexDirection="column">
          <Text>API key for <Text color="cyan">{provider.label}</Text>:</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            mask="*"
            onSubmit={(val) => {
              if (!val.trim()) return;
              if (provider.key === "custom") {
                setStep("baseurl");
              } else {
                runTest(provider, val, provider.defaultBaseUrl ?? "");
                setStep("testing");
              }
            }}
          />
        </Box>
      )}

      {step === "baseurl" && (
        <Box flexDirection="column">
          <Text>Base URL <Text dimColor>(e.g. http://localhost:8080/v1)</Text>:</Text>
          <TextInput
            value={baseUrl}
            onChange={setBaseUrl}
            onSubmit={(val) => {
              runTest(provider, apiKey, val);
              setStep("testing");
            }}
          />
        </Box>
      )}

      {step === "testing" && (
        <Box flexDirection="column">
          {testStatus === "testing" && <Text color="yellow">⟳ Testing connection to {provider.label}...</Text>}
          {testStatus === "ok"      && <Text color="green">✓ Connected!</Text>}
          {testStatus === "fail"    && <Text color="red">✗ Failed: <Text dimColor>{testError}</Text></Text>}
        </Box>
      )}

      {step === "model" && (
        <Box flexDirection="column">
          <Text>Select model:</Text>
          {availableModels.length > 0 ? (() => {
            const WINDOW = 8;
            const start = Math.max(0, Math.min(modelIdx - Math.floor(WINDOW / 2), availableModels.length - WINDOW));
            const visible = availableModels.slice(start, start + WINDOW);
            return (
              <Box flexDirection="column">
                {start > 0 && <Text dimColor>  ↑ {start} more</Text>}
                {visible.map((m, vi) => {
                  const gi = start + vi;
                  return (
                    <Text key={m} color={gi === modelIdx ? "cyan" : undefined}>
                      {gi === modelIdx ? "▶ " : "  "}{m}
                    </Text>
                  );
                })}
                {start + WINDOW < availableModels.length && (
                  <Text dimColor>  ↓ {availableModels.length - start - WINDOW} more</Text>
                )}
              </Box>
            );
          })() : (
            <Box flexDirection="column">
              <Text dimColor>Could not fetch model list. Enter model name:</Text>
              <TextInput
                value={model}
                onChange={setModel}
                onSubmit={() => setStep("permission")}
              />
            </Box>
          )}
          {availableModels.length > 0 && <Text dimColor>↑↓ navigate  Enter select</Text>}
        </Box>
      )}

      {step === "permission" && (
        <Box flexDirection="column">
          <Text>Permission mode:</Text>
          {PERMISSION_MODES.map((p, i) => (
            <Text key={p.key} color={i === permIdx ? "cyan" : undefined}>
              {i === permIdx ? "▶ " : "  "}{p.label}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>↑↓ navigate  Enter select</Text>
        </Box>
      )}

      {step === "gotchi" && (
        <Box flexDirection="column">
          <Text>Hatch a cybergotchi companion? <Text dimColor>(Y/n)</Text></Text>
        </Box>
      )}
    </Box>
  );
}
