/**
 * Branded welcome shown when a conversation starts (before the main menu).
 * For WhatsApp Cloud API *templates*, register the same copy in Meta with {{1}} = full name
 * (see META_WELCOME_TEMPLATE_BODY_SNIPPET).
 */
export function formatWelcomeMessage(displayName: string): string {
  const greetingName = displayName.trim() || "there";
  return [
    `Hi ${greetingName} 👋`,
    "",
    "Welcome to Pure Harvests!",
    "",
    "🌾 From Our Farm to Your Kitchen",
    "Fresh • Honest • Transparent",
    "",
    "Freshly prepared. No storage. Pure quality.",
  ].join("\n");
}

/**
 * Paste this into your approved WhatsApp template body (one variable).
 * Variable {{1}} = customer full name, e.g. "Rajat Tyagi".
 */
export const META_WELCOME_TEMPLATE_BODY_SNIPPET = `Hi {{1}} 👋

Welcome to Pure Harvests!

🌾 From Our Farm to Your Kitchen
Fresh • Honest • Transparent

Freshly prepared. No storage. Pure quality.`;
