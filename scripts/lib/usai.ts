/**
 * Minimal client for the GSA USAi gateway (OpenAI-compatible chat completions).
 *
 * This is the ONLY place the tool talks to an LLM. It is used exclusively by the
 * opt-in, operator-invoked authoring scripts (Layers A and B) — never by the
 * reviewer app. All egress goes to the GSA USAi gateway; the API key is read
 * from the environment and never logged.
 *
 * Env:
 *   USAI_API_KEY   (required)  — bearer token for the gateway
 *   USAI_BASE_URL  (optional)  — defaults to https://api.gsa.usai.gov/api/v1
 *   USAI_MODEL     (optional)  — defaults to claude_4_8_opus
 */
import { readFileSync } from 'node:fs';

const DEFAULT_BASE_URL = 'https://api.gsa.usai.gov/api/v1';
const DEFAULT_MODEL = 'claude_4_8_opus';

/** Load USAI_API_KEY from the environment, falling back to a local .env file. */
function loadApiKey(): string {
  if (process.env.USAI_API_KEY) return process.env.USAI_API_KEY;
  // Node's built-in .env loader (best-effort); scripts may run outside `npm`.
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
  } catch {
    // ignore — fall through to manual parse
  }
  if (process.env.USAI_API_KEY) return process.env.USAI_API_KEY;
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*USAI_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env
  }
  throw new Error(
    'USAI_API_KEY is not set. Export it in the environment (never hardcode it).',
  );
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UsaiOptions {
  model?: string;
  /**
   * 0..1; low for deterministic, structured output. Omitted from the request
   * unless explicitly set — some gateway models reject/deprecate `temperature`.
   */
  temperature?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
}

export interface UsaiClient {
  model: string;
  baseUrl: string;
  chat(messages: ChatMessage[], opts?: UsaiOptions): Promise<string>;
  /** Chat, then parse the response as JSON (tolerating ```json fences). */
  chatJson<T>(messages: ChatMessage[], opts?: UsaiOptions): Promise<T>;
}

/** Sleep helper for rate-limit throttling / backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createUsaiClient(opts: UsaiOptions = {}): UsaiClient {
  const apiKey = loadApiKey();
  const baseUrl = process.env.USAI_BASE_URL ?? DEFAULT_BASE_URL;
  const model = opts.model ?? process.env.USAI_MODEL ?? DEFAULT_MODEL;

  // Client-side throttle: USAi allows 3 chat calls/sec/key. Keep >=350ms between
  // calls, and retry 429s with exponential backoff.
  let lastCallAt = 0;
  const MIN_INTERVAL_MS = 350;
  const MAX_RETRIES = 5;

  async function chat(messages: ChatMessage[], call: UsaiOptions = {}): Promise<string> {
    const temperature = call.temperature ?? opts.temperature;
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), call.timeoutMs ?? 300_000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'nist-tracker-agentic/1.0 (GSA-TTS)',
          },
          body: JSON.stringify({
            model: call.model ?? model,
            ...(temperature != null ? { temperature } : {}),
            messages,
          }),
          signal: controller.signal,
        });
        if (res.status === 429 && attempt < MAX_RETRIES) {
          const backoff = Math.min(8000, 500 * 2 ** attempt);
          console.warn(`  USAi 429 rate-limited; backing off ${backoff}ms`);
          await sleep(backoff);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`USAi ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('USAi response had no message content');
        }
        return content;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  async function chatJson<T>(messages: ChatMessage[], call: UsaiOptions = {}): Promise<T> {
    const raw = await chat(messages, call);
    return parseJsonLoose<T>(raw);
  }

  return { model, baseUrl, chat, chatJson };
}

/** Extract and parse JSON from a model response, tolerating markdown fences. */
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // If there's leading/trailing prose, grab the outermost JSON object/array.
  if (!/^[[{]/.test(text)) {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse model output as JSON: ${(e as Error).message}\n---\n${raw.slice(0, 800)}`,
    );
  }
}
