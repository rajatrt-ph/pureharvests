export type BotIntent = "menu" | "order" | "track" | "unknown";

const INTENT_MAP: Array<{ keywords: string[]; intent: BotIntent }> = [
  { keywords: ["hi", "hello", "hey", "namaste"], intent: "menu" },
  { keywords: ["order", "buy"], intent: "order" },
  { keywords: ["track", "tracking", "where is my order", "order status", "delivery status"], intent: "track" },
];

export function detectIntent(input: string): BotIntent {
  const text = input.toLowerCase().trim();

  if (!text) return "unknown";

  for (const rule of INTENT_MAP) {
    if (rule.keywords.some((word) => text.includes(word))) {
      return rule.intent;
    }
  }

  return "unknown";
}

