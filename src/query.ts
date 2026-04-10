/**
 * Re-export from query/index.ts — the agent loop has been split into sub-modules:
 * - query/index.ts — main orchestration loop
 * - query/compress.ts — message compression strategies
 * - query/tools.ts — tool execution, permission checking, batching
 * - query/errors.ts — error classification and recovery
 * - query/types.ts — shared types
 */
export { query, compressMessages } from "./query/index.js";
export type { QueryConfig, QueryLoopState } from "./query/index.js";
