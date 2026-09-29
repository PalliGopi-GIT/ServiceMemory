import { z } from "zod";

/**
 * Server-side environment access. Validated lazily so `next build` and unit tests
 * don't need real credentials. Nothing here uses NEXT_PUBLIC_, so nothing reaches the browser.
 */
function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/env must only be imported from server code.");
  }
}

const hindsightSchema = z.object({
  HINDSIGHT_BASE_URL: z.string().url().default("https://api.hindsight.vectorize.io"),
  HINDSIGHT_API_KEY: z.string().min(1, "HINDSIGHT_API_KEY is required"),
  HINDSIGHT_BANK_ID: z.string().min(1).default("servicememory-org"),
});

const supabaseSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
});

const llmSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z
    .string()
    .min(1)
    .default("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"),
  /** Optional override for the OpenRouter base URL (default: https://openrouter.ai/api/v1). */
  OPENROUTER_BASE_URL: z.string().url().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  assertServer();
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ${label} configuration: ${issues}`);
  }
  return result.data;
}

export const getHindsightEnv = () => parse(hindsightSchema, "Hindsight");
export const getSupabaseEnv = () => parse(supabaseSchema, "Supabase");
export const getLlmEnv = () => parse(llmSchema, "LLM");
