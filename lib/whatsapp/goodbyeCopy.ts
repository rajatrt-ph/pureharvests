/**
 * Goodbye shown when the user cancels / stops the conversation.
 * For WhatsApp templates, register the same copy in Meta with {{1}} = full name
 * (see META_GOODBYE_TEMPLATE_BODY_SNIPPET).
 */
export function formatGoodbyeMessage(displayName: string): string {
  const n = displayName.trim() || "there";
  return [
    `Thank you, ${n} 🌿`,
    "",
    "We truly appreciate your time with Pure Harvests.",
    "",
    `Whenever you need fresh, honest, and transparent products—just drop a "Hi" 👋`,
    "We'll be happy to serve you again.",
  ].join("\n");
}

/**
 * Paste into your approved WhatsApp goodbye template (one variable).
 * {{1}} = customer full name, e.g. "Rajat Tyagi".
 */
export const META_GOODBYE_TEMPLATE_BODY_SNIPPET = `Thank you, {{1}} 🌿

We truly appreciate your time with Pure Harvests.

Whenever you need fresh, honest, and transparent products—just drop a "Hi" 👋
We'll be happy to serve you again.`;
