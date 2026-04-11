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
  { key: "llamacpp",   label: "llama.cpp / GGUF (local, no Ollama needed)", defaultModel: "", needsApiKey: false, defaultBaseUrl: "http://localhost:8080" },
  { key: "lmstudio",   label: "LM Studio (local, OpenAI-compatible)",       defaultModel: "", needsApiKey: false, defaultBaseUrl: "http://localhost:1234" },
  { key: "custom",     label: "Custom (OpenAI-compatible)",defaultModel: "",                 needsApiKey: true  },
];

const PERMISSION_MODES = [
  { key: "ask",   label: "ask   — prompt before each tool call (recommended)" },
  { key: "trust", label: "trust — auto-approve everything" },
  { key: "deny",  label: "deny  — read-only, block write/run tools" },
];

/** Auto-detect provider from environment variables */
function detectProviderFromEnv(): number {
  if (process.env.ANTHROPIC_API_KEY) return PROVIDERS.findIndex(p => p.key === "anthropic");
  if (process.env.OPENAI_API_KEY) return PROVIDERS.findIndex(p => p.key === "openai");
  if (process.env.OPENROUTER_API_KEY) return PROVIDERS.findIndex(p => p.key === "openrouter");
  return 0; // Default to Ollama
}

/** Get the detected API key for a provider */
function getEnvApiKey(providerKey: string): string {
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envVar = envMap[providerKey];
  return envVar ? (process.env[envVar] ?? '') : '';
}

type Step = "provider" | "apikey" | "baseurl" | "testing" | "model" | "permission" | "mcp" | "gotchi" | "done";

// ── Component ──

interface Props {
  onDone?: () => void;
}

export default function InitWizard({ onDone }: Props) {
  const detectedIdx = detectProviderFromEnv();
  const [step, setStep] = useState<Step>("provider");
  const [providerIdx, setProviderIdx] = useState(detectedIdx);
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
  const [suggestedMcp, setSuggestedMcp] = useState<string[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set());
  const [mcpIdx, setMcpIdx] = useState(0);

  const provider = PROVIDERS[providerIdx]!;

  // ── Keyboard navigation ──

  useInput(useCallback((input, key) => {
    if (step === "provider") {
      if (key.upArrow) setProviderIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1));
      if (key.return) {
        setBaseUrl(provider.defaultBaseUrl ?? "");
        setModel(provider.defaultModel);
        // Auto-fill API key from environment if available
        const envKey = getEnvApiKey(provider.key);
        if (envKey) setApiKey(envKey);

        if (!provider.needsApiKey) {
          runTest(provider, "", provider.defaultBaseUrl ?? "");
          setStep("testing");
        } else if (envKey) {
          // Have env API key — skip manual entry, go to testing
          runTest(provider, envKey, provider.defaultBaseUrl ?? "");
          setStep("testing");
        } else {
          setStep("apikey");
        }
      }
    }

    if (step === "permission") {
      if (key.upArrow) setPermIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setPermIdx(i => Math.min(PERMISSION_MODES.length - 1, i + 1));
      if (key.return) {
        // Suggest popular MCP servers
        setSuggestedMcp(['github', 'memory', 'fetch', 'sequential-thinking', 'brave-search']);
        setMcpIdx(0);
        setSelectedMcp(new Set());
        setStep("mcp");
      }
    }

    if (step === "mcp") {
      if (key.upArrow) setMcpIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setMcpIdx(i => Math.min(suggestedMcp.length - 1, i + 1));
      if (input === " ") {
        // Toggle selection
        const name = suggestedMcp[mcpIdx];
        if (name) {
          setSelectedMcp(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
          });
        }
      }
      if (key.return) setStep("gotchi");
      if (input === "s" || input === "S") setStep("gotchi"); // Skip
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

    // Build MCP server configs from selected registry entries
    let mcpServers: any[] | undefined;
    if (selectedMcp.size > 0) {
      try {
        const { MCP_REGISTRY } = require('../mcp/registry.js');
        mcpServers = [...selectedMcp]
          .map(name => MCP_REGISTRY.find((e: any) => e.name === name))
          .filter(Boolean)
          .map((e: any) => ({
            name: e.name,
            command: 'npx',
            args: ['-y', e.package, ...(e.args ?? [])],
            ...(e.envVars?.length ? { env: Object.fromEntries(e.envVars.map((v: string) => [v, `YOUR_${v}`])) } : {}),
          }));
      } catch { /* ignore */ }
    }

    writeOhConfig({
      provider: provider.key,
      model: selectedModel || provider.defaultModel,
      permissionMode: PERMISSION_MODES[permIdx]!.key as any,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(mcpServers?.length ? { mcpServers } : {}),
    });
    setStep("done");
    setTimeout(() => onDone?.(), 1500);
  }, [provider, model, availableModels, modelIdx, permIdx, apiKey, baseUrl, selectedMcp]);

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
          <Text>Select provider:{detectedIdx > 0 ? <Text dimColor> (auto-detected from env)</Text> : ''}</Text>
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

      {step === "testing" && provider.key === "llamacpp" && testStatus !== "ok" && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text color="cyan">llama.cpp setup</Text>
          <Text dimColor>To use llama.cpp, start llama-server first:</Text>
          <Text dimColor>  llama-server --model ./your-model.gguf --port 8080 --alias my-model</Text>
          <Text dimColor>Then enter "my-model" as the model name below.</Text>
        </Box>
      )}

      {step === "testing" && provider.key === "lmstudio" && testStatus !== "ok" && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text color="cyan">LM Studio setup</Text>
          <Text dimColor>Enable the local server in LM Studio:</Text>
          <Text dimColor>  Settings → Local Server → Start Server (port 1234)</Text>
          <Text dimColor>Then load a model and set the model name below.</Text>
        </Box>
      )}

      {step === "testing" && (
        <Box flexDirection="column">
          {testStatus === "testing" && <Text color="yellow">⟳ Testing connection to {provider.label}...</Text>}
          {testStatus === "ok"      && <Text color="green">✓ Connected!</Text>}
          {testStatus === "fail" && provider.key !== "llamacpp" && provider.key !== "lmstudio" && (
            <Text color="red">✗ Failed: <Text dimColor>{testError}</Text></Text>
          )}
          {testStatus === "fail" && provider.key === "lmstudio" && (
            <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginTop={1}>
              <Text color="red">✗ Could not connect to LM Studio.</Text>
              <Text dimColor>{testError}</Text>
              <Text> </Text>
              <Text color="yellow">Make sure LM Studio local server is running:</Text>
              <Text dimColor>  Settings → Local Server → Start Server (port 1234)</Text>
            </Box>
          )}
          {testStatus === "fail" && provider.key === "llamacpp" && (
            <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginTop={1}>
              <Text color="red">✗ Could not connect to llama-server.</Text>
              <Text dimColor>{testError}</Text>
              <Text> </Text>
              <Text color="yellow">Make sure llama-server is running:</Text>
              <Text dimColor>  llama-server --model ./your-model.gguf --port 8080 --alias my-model</Text>
            </Box>
          )}
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

      {step === "mcp" && (
        <Box flexDirection="column">
          <Text>Add MCP servers? <Text dimColor>(Space to toggle, Enter to confirm, S to skip)</Text></Text>
          <Text> </Text>
          {suggestedMcp.map((name, i) => (
            <Text key={name} color={i === mcpIdx ? "cyan" : undefined}>
              {i === mcpIdx ? "▶ " : "  "}
              {selectedMcp.has(name) ? "[✓] " : "[ ] "}
              {name}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>↑↓ navigate  Space toggle  Enter confirm  S skip</Text>
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
