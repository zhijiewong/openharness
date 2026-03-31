import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";

import { Command, Option } from "commander";
import type { BridgeEnvelope, InputEnvelope, ResponseEnvelope } from "./protocol.js";
import { sendBridgeRequest, streamBridgeRequest } from "./transport/stdio.js";

const VALID_PERMISSION_MODES = ["ask", "trust", "deny"] as const;

const program = new Command();

program
  .name("oh-ts")
  .description("TypeScript CLI frontend for OpenHarness")
  .version("0.1.0-alpha.0");

program
  .command("version")
  .description("Ask the Python bridge for version information")
  .action(async () => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "app.version",
    });
    printResponse(response);
  });

program
  .command("chat")
  .description("Run chat via the Python bridge")
  .argument("[prompt]", "Prompt to send to the agent")
  .option("-m, --model <model>", "Model override")
  .option("-r, --resume <sessionId>", "Resume a saved session by ID")
  .option("--session-dir <path>", "Override session directory")
  .addOption(new Option("--permission-mode <mode>", "Permission mode").choices(VALID_PERMISSION_MODES).default("deny"))
  .option("--trust", "Shortcut for --permission-mode trust")
  .action(async (
    prompt: string | undefined,
    options: { model?: string; resume?: string; sessionDir?: string; permissionMode: string; trust?: boolean },
  ) => {
    const permissionMode = options.trust ? "trust" : options.permissionMode;
    if (prompt) {
      await runChatTurn(prompt, options.model, permissionMode, options.resume, options.sessionDir);
      return;
    }

    await runInteractiveChat(options.model, permissionMode, options.resume, options.sessionDir);
  });

const config = program.command("config").description("Read and update configuration");

config
  .command("show")
  .description("Show current configuration from the Python core")
  .option("--config-path <path>", "Override config file path")
  .action(async (options: { configPath?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "config.show",
      params: {
        config_path: options.configPath ?? null,
      },
    });
    printResponse(response);
  });

config
  .command("set")
  .description("Set a configuration value in the Python core")
  .argument("<key>", "Config key")
  .argument("<value>", "Config value")
  .option("--config-path <path>", "Override config file path")
  .action(async (key: string, value: string, options: { configPath?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "config.set",
      params: {
        key,
        value,
        config_path: options.configPath ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("sessions")
  .description("List saved sessions")
  .option("--session-dir <path>", "Override session directory")
  .action(async (options: { sessionDir?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "sessions.list",
      params: {
        session_dir: options.sessionDir ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("cost")
  .description("Show cost summary")
  .option("--cost-dir <path>", "Override cost directory")
  .action(async (options: { costDir?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "cost.summary",
      params: {
        cost_dir: options.costDir ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("tools")
  .description("List available tools")
  .action(async () => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "tools.list",
    });
    printResponse(response);
  });

program
  .command("models")
  .description("List available models")
  .option("-p, --provider <provider>", "Filter by provider")
  .action(async (options: { provider?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "models.list",
      params: {
        provider: options.provider ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("rules")
  .description("List project rules")
  .option("--init", "Create .oh/RULES.md if needed")
  .option("--project-path <path>", "Override project path")
  .action(async (options: { init?: boolean; projectPath?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "rules.list",
      params: {
        create: options.init ?? false,
        project_path: options.projectPath ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("skills")
  .description("List available skills")
  .option("--project-path <path>", "Override project path")
  .action(async (options: { projectPath?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "skills.list",
      params: {
        project_path: options.projectPath ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("memory")
  .description("List or search memories")
  .option("-s, --search <term>", "Search memories")
  .option("--memory-dir <path>", "Override memory directory")
  .action(async (options: { search?: string; memoryDir?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "memory.list",
      params: {
        search: options.search ?? null,
        memory_dir: options.memoryDir ?? null,
      },
    });
    printResponse(response);
  });

program
  .command("init")
  .description("Initialize OpenHarness in the current project")
  .option("--project-path <path>", "Override project path")
  .option("--config-path <path>", "Override config file path")
  .action(async (options: { projectPath?: string; configPath?: string }) => {
    const response = await sendBridgeRequest({
      id: randomUUID(),
      method: "project.init",
      params: {
        project_path: options.projectPath ?? null,
        config_path: options.configPath ?? null,
      },
    });
    printResponse(response);
  });

async function runInteractiveChat(
  model: string | undefined,
  permissionMode: string,
  initialResume: string | undefined,
  sessionDir: string | undefined,
): Promise<void> {
  stderr.write(`OpenHarness TS chat (${permissionMode} mode)\n`);
  stderr.write("Type 'exit' or press Ctrl+C to quit.\n\n");

  const rl = createInterface({ input, output });
  let activeResume = initialResume;

  try {
    while (true) {
      const prompt = (await rl.question("> ")).trim();
      if (!prompt) {
        continue;
      }
      if (isExitCommand(prompt)) {
        break;
      }

      activeResume = await runChatTurn(
        prompt,
        model,
        permissionMode,
        activeResume,
        sessionDir,
        async (message) => {
          const answer = (await rl.question(`${message} [y/n]: `)).trim().toLowerCase();
          return answer === "y" || answer === "yes";
        },
      );
      output.write("\n");
    }
  } finally {
    rl.close();
  }
}

async function runChatTurn(
  prompt: string,
  model: string | undefined,
  permissionMode: string,
  resume: string | undefined,
  sessionDir: string | undefined,
  askPermission?: (message: string) => Promise<boolean>,
): Promise<string | undefined> {
  let nextSessionId = resume;
  await streamBridgeRequest(
    {
      id: randomUUID(),
      method: "chat.start",
      params: {
        prompt,
        model: model ?? null,
        permission_mode: permissionMode,
        resume: resume ?? null,
        session_dir: sessionDir ?? null,
      },
    },
    async (event) => {
      const result = await printStreamEvent(event, askPermission);
      if (typeof result === "string") {
        nextSessionId = result;
        return undefined;
      }
      return result;
    },
  );
  return nextSessionId;
}

async function askPermissionOneshot(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [y/n]: `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function isExitCommand(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return normalized === "exit" || normalized === "quit" || normalized === "/exit" || normalized === "/quit";
}

function printResponse(response: ResponseEnvelope): void {
  if (response.event === "error") {
    console.error(`Error [${response.data.code}]: ${response.data.message}`);
    process.exitCode = 1;
    return;
  }

  const data = response.data ?? {};

  if (typeof data.version === "string" && typeof data.name === "string") {
    console.log(`${data.name} v${data.version}`);
    return;
  }

  if (typeof data.updated === "string") {
    console.log(`Updated ${data.updated} in ${String(data.path ?? "")}`);
    return;
  }

  if (Array.isArray(data.sessions)) {
    if (data.sessions.length === 0) {
      console.log("No saved sessions.");
      return;
    }
    for (const session of data.sessions as Array<Record<string, unknown>>) {
      console.log(
        `${String(session.id ?? "")}\t${String(session.model ?? "-")}\t${String(session.messages ?? 0)} msgs\t${formatMaybeCost(session.cost)}`,
      );
    }
    return;
  }

  if (Array.isArray(data.tools)) {
    for (const tool of data.tools as Array<Record<string, unknown>>) {
      console.log(
        `${String(tool.name ?? "")}\t${String(tool.risk ?? "")}\t${Boolean(tool.read_only) ? "ro" : "rw"}\t${String(tool.description ?? "")}`,
      );
    }
    return;
  }

  if (Array.isArray(data.models)) {
    prettyPrintModels(data.models as Array<Record<string, unknown>>);
    return;
  }

  if (Array.isArray(data.files) && typeof data.prompt_length === "number") {
    prettyPrintRules(data as Record<string, unknown>);
    return;
  }

  if (typeof data.count === "number" && Array.isArray(data.skills)) {
    if (data.count === 0) {
      console.log("No skills found.");
      return;
    }
    for (const skill of data.skills as Array<Record<string, unknown>>) {
      console.log(`${String(skill.name ?? "")}\t${String(skill.source ?? "")}\t${String(skill.context ?? "")}\t${String(skill.description ?? "")}`);
    }
    return;
  }

  if (typeof data.count === "number" && Array.isArray(data.memories)) {
    prettyPrintMemories(data as Record<string, unknown>);
    return;
  }

  if ("project_path" in data && Array.isArray(data.created)) {
    if (data.created.length === 0) {
      console.log("Project already initialized.");
      return;
    }
    console.log(`Initialized ${String(data.project_path ?? "")}`);
    for (const entry of data.created as Array<string>) {
      console.log(`Created ${entry}`);
    }
    return;
  }

  if ("has_data" in data) {
    if (!data.has_data) {
      console.log("No cost data yet.");
      return;
    }
    if (typeof data.summary === "string") {
      console.log(data.summary);
    }
    const byProvider = data.by_provider as Record<string, number> | undefined;
    if (byProvider && Object.keys(byProvider).length > 0) {
      console.log("\nBy provider:");
      for (const [provider, cost] of Object.entries(byProvider)) {
        console.log(`${provider}\t$${cost.toFixed(4)}`);
      }
    }
    return;
  }

  if (typeof data.path === "string" && "provider" in data && "model" in data) {
    prettyPrintConfig(data as Record<string, unknown>);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

async function printStreamEvent(
  event: BridgeEnvelope,
  askPermission?: (message: string) => Promise<boolean>,
): Promise<string | InputEnvelope | undefined> {
  if (event.event === "error") {
    console.error(`Error [${event.data.code}]: ${event.data.message}`);
    process.exitCode = 1;
    return undefined;
  }

  const data = event.data ?? {};

  switch (event.event) {
    case "session_start":
      console.error([
        `OpenHarness ${String(data.provider ?? "")}/${String(data.model ?? "")}`,
        `(${String(data.permission_mode ?? "")})`,
        data.resumed === true ? `[resumed ${String(data.session_id ?? "")}]` : `[session ${String(data.session_id ?? "")}]`,
      ].join(" "));
      return typeof data.session_id === "string" ? data.session_id : undefined;
    case "text_delta":
      process.stdout.write(String(data.content ?? ""));
      return undefined;
    case "tool_call_start":
      console.error(`\n[tool] ${String(data.tool_name ?? "")}`);
      return undefined;
    case "tool_call_end":
      if (typeof data.output === "string" && data.output.trim()) {
        console.error(summarizeToolOutput(data.output, 6));
      }
      console.error(data.is_error === true ? "[tool:error]" : "[tool:done]");
      return undefined;
    case "permission_request": {
      const description = String(data.description ?? "");
      const toolName = String(data.tool_name ?? "");
      const handler = askPermission ?? askPermissionOneshot;
      const allowed = await handler(`${toolName}: ${description}`);
      return {
        method: "permission.response",
        params: {
          allow: allowed,
        },
      };
    }
    case "turn_complete":
      console.error(`\n[done] session ${String(data.session_id ?? "")}`);
      return typeof data.session_id === "string" ? data.session_id : undefined;
    default:
      console.log(JSON.stringify(data, null, 2));
      return undefined;
  }
}

function prettyPrintConfig(data: Record<string, unknown>): void {
  console.log(`Config: ${String(data.path ?? "")}`);
  console.log(`provider: ${String(data.provider ?? "")}`);
  console.log(`model: ${String(data.model ?? "")}`);
  console.log(`permission_mode: ${String(data.permission_mode ?? "")}`);
  console.log(`max_cost_per_session: ${String(data.max_cost_per_session ?? 0)}`);
  const providers = data.providers as Record<string, Record<string, unknown>> | undefined;
  if (providers && Object.keys(providers).length > 0) {
    console.log("\nproviders:");
    for (const [name, provider] of Object.entries(providers)) {
      const apiKey = typeof provider.api_key === "string" && provider.api_key
        ? `***${provider.api_key.slice(-4)}`
        : "(not set)";
      console.log(
        `  ${name}: api_key=${apiKey} base_url=${String(provider.base_url ?? "")} default_model=${String(provider.default_model ?? "")}`,
      );
    }
  }
}

function prettyPrintModels(models: Array<Record<string, unknown>>): void {
  for (const model of models) {
    const context = model.context_window == null ? "-" : String(model.context_window);
    const price = model.input_cost_per_mtok == null
      ? "-"
      : `$${String(model.input_cost_per_mtok)}/$${String(model.output_cost_per_mtok)} per 1M`;
    console.log(
      `${String(model.id ?? "")}\t${String(model.provider ?? "")}\tctx=${context}\ttools=${String(Boolean(model.supports_tools))}\t${price}`,
    );
  }
}

function prettyPrintRules(data: Record<string, unknown>): void {
  if (typeof data.created_path === "string" && data.created_path) {
    console.log(`Created ${data.created_path}`);
  }
  const files = data.files as Array<string>;
  if (files.length === 0) {
    console.log("No rules loaded.");
    return;
  }
  console.log(`Rules (${files.length}), prompt length ${String(data.prompt_length ?? 0)}`);
  for (const file of files) {
    console.log(file);
  }
}

function prettyPrintMemories(data: Record<string, unknown>): void {
  if (data.count === 0) {
    console.log("No memories found.");
    return;
  }
  for (const memory of data.memories as Array<Record<string, unknown>>) {
    console.log(
      `${String(memory.id ?? "")}\t${String(memory.type ?? "")}\t${String(memory.title ?? "")}\t${String(memory.description ?? "")}`,
    );
  }
}

function summarizeToolOutput(outputText: string, maxLines: number): string {
  const lines = outputText.trim().split(/\r?\n/);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  return `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length} lines total)`;
}

function formatMaybeCost(value: unknown): string {
  return typeof value === "number" && value > 0 ? `$${value.toFixed(4)}` : "-";
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
