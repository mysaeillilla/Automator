export interface JsonBlock {
  text: string;      // full pretty-printed value (used by Copy)
  preview: string;   // what the page renders
  truncated: boolean;
}

// Keeps huge Excel outputs from freezing the page
const MAX_PREVIEW_CHARS = 20_000;

export function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

// Strings that contain JSON (like the double-encoded outputs) are expanded recursively
function expand(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const looksLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (looksLikeJson) {
      try {
        return expand(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  }
  return value;
}

export function prettyJson(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return JSON.stringify(expand(JSON.parse(raw)), null, 2);
  } catch {
    return raw; // not JSON: show as is
  }
}

export function toJsonBlock(raw: string | null | undefined): JsonBlock | null {
  const text = prettyJson(raw);
  if (!text) return null;
  const truncated = text.length > MAX_PREVIEW_CHARS;
  return { text, preview: truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text, truncated };
}
