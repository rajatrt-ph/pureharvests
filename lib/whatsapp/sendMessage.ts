import { isValidPhone, normalizePhone } from "@/lib/utils/phone";

type WhatsAppSendResponse = {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
};

type WhatsAppInteractiveMenuOption = {
  id: string;
  title: string;
  description?: string;
};

type WhatsAppMenuPayload = {
  type: "menu";
  header?: string;
  body: string;
  footer?: string;
  imageUrl?: string;
  buttonText?: string;
  sectionTitle?: string;
  options: WhatsAppInteractiveMenuOption[];
};

/** Call-to-action URL button — no raw URL in the body (WhatsApp shows a tappable button). */
type WhatsAppCtaUrlPayload = {
  type: "cta_url";
  header?: string;
  body: string;
  footer?: string;
  /** Shown on the button (keep short; Meta limits apply). */
  buttonText: string;
  url: string;
};

type WhatsAppTextPayload = {
  type?: "text";
  text: string;
};

type WhatsAppMessagePayload = string | WhatsAppTextPayload | WhatsAppMenuPayload | WhatsAppCtaUrlPayload;
type WhatsAppTemplateLanguage = { code: string };
type WhatsAppTemplateParameter =
  | { type: "text"; text: string }
  | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: "date_time"; date_time: { fallback_value: string } };
type WhatsAppTemplateComponent =
  | {
      type: "header";
      parameters: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: { link: string } }
        | { type: "video"; video: { link: string } }
        | { type: "document"; document: { link: string; filename?: string } }
      >;
    }
  | {
      type: "body";
      parameters: WhatsAppTemplateParameter[];
    }
  | {
      type: "button";
      sub_type: "quick_reply" | "url";
      index: string;
      parameters: Array<{ type: "payload"; payload: string } | { type: "text"; text: string }>;
    };

export type WhatsAppTemplatePayload = {
  name: string;
  language: WhatsAppTemplateLanguage;
  components?: WhatsAppTemplateComponent[];
};

function normalizeMessagePayload(input: WhatsAppMessagePayload) {
  if (typeof input === "string") {
    return { type: "text" as const, text: input };
  }
  if (input.type === "menu") {
    return input;
  }
  if (input.type === "cta_url") {
    return input;
  }
  return { type: "text" as const, text: input.text };
}

export async function sendMessage(to: string, message: WhatsAppMessagePayload) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("Missing WhatsApp env vars: WHATSAPP_TOKEN / PHONE_NUMBER_ID");
  }

  const normalizedPhone = normalizePhone(to);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  const normalizedPayload = normalizeMessagePayload(message);

  const endpoint = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload =
    normalizedPayload.type === "menu"
      ? {
          messaging_product: "whatsapp",
          to: normalizedPhone,
          type: "interactive",
          interactive: {
            type: "list",
            ...(normalizedPayload.header || normalizedPayload.imageUrl
              ? {
                  header: normalizedPayload.imageUrl
                    ? {
                        type: "image",
                        image: { link: normalizedPayload.imageUrl },
                      }
                    : {
                        type: "text",
                        text: normalizedPayload.header,
                      },
                }
              : {}),
            body: {
              text: normalizedPayload.body,
            },
            ...(normalizedPayload.footer
              ? {
                  footer: {
                    text: normalizedPayload.footer,
                  },
                }
              : {}),
            action: {
              button: normalizedPayload.buttonText ?? "Choose",
              sections: [
                {
                  title: normalizedPayload.sectionTitle ?? "Menu",
                  rows: normalizedPayload.options.map((option) => ({
                    id: option.id,
                    title: option.title,
                    ...(option.description ? { description: option.description } : {}),
                  })),
                },
              ],
            },
          },
        }
      : normalizedPayload.type === "cta_url"
        ? (() => {
            const url = normalizedPayload.url.trim();
            if (!/^https:\/\//i.test(url)) {
              throw new Error("CTA URL must use https");
            }
            const bodyText = normalizedPayload.body.trim();
            if (!bodyText) {
              throw new Error("CTA body text is required");
            }
            return {
              messaging_product: "whatsapp",
              to: normalizedPhone,
              type: "interactive",
              interactive: {
                type: "cta_url",
                ...(normalizedPayload.header
                  ? {
                      header: {
                        type: "text",
                        text: normalizedPayload.header,
                      },
                    }
                  : {}),
                body: { text: bodyText },
                ...(normalizedPayload.footer
                  ? {
                      footer: {
                        text: normalizedPayload.footer,
                      },
                    }
                  : {}),
                action: {
                  name: "cta_url",
                  parameters: {
                    display_text: normalizedPayload.buttonText.trim() || "Open link",
                    url,
                  },
                },
              },
            };
          })()
        : (() => {
            const messageText = normalizedPayload.text.trim();
            if (!messageText) {
              throw new Error("Message text is required");
            }
            return {
              messaging_product: "whatsapp",
              to: normalizedPhone,
              type: "text",
              text: {
                body: messageText,
              },
            };
          })();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as
    | WhatsAppSendResponse
    | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      "error" in data && data.error?.message
        ? data.error.message
        : `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`WhatsApp send failed: ${message}`);
  }

  return data;
}

export async function sendTemplateMessage(phone: string, template: WhatsAppTemplatePayload) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("Missing WhatsApp env vars: WHATSAPP_TOKEN / PHONE_NUMBER_ID");
  }

  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  if (!template.name.trim()) {
    throw new Error("Template name is required");
  }

  const endpoint = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as
    | WhatsAppSendResponse
    | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      "error" in data && data.error?.message
        ? data.error.message
        : `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`WhatsApp template send failed: ${message}`);
  }

  return data;
}

