import { logger } from "@/lib/utils/logger";
import { sendTemplateMessage, type WhatsAppTemplatePayload } from "@/lib/whatsapp/sendMessage";

/** Only admin-driven logistics updates; created/confirmed are user + payment flow (plain text / webhook). */
const NOTIFY_STATUSES = new Set(["shipped", "delivered"]);

function readEnvName(key: string): string {
  return (process.env[key] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Language for shipped/delivered templates only. Must match the *exact* locale row in WhatsApp Manager
 * for each template (e.g. `en_US`). If unset, falls back to WHATSAPP_TEMPLATE_LANGUAGE, then `en`.
 * Meta error (#132001) "Template name does not exist in the translation" = wrong name OR wrong language code.
 */
function getOrderStatusTemplateLanguage(): string {
  const orderOnly = readEnvName("WHATSAPP_TEMPLATE_ORDER_LANGUAGE");
  if (orderOnly) return orderOnly;
  const shared = readEnvName("WHATSAPP_TEMPLATE_LANGUAGE");
  if (shared) return shared;
  return "en";
}

function buildOrderStatusTemplatePayload(
  templateName: string,
  languageCode: string,
  orderRef: string,
  customerName: string,
): WhatsAppTemplatePayload {
  const components: NonNullable<WhatsAppTemplatePayload["components"]> = [];

  const headerImageUrl = process.env.WHATSAPP_ORDER_STATUS_HEADER_IMAGE_URL?.trim();
  if (headerImageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: headerImageUrl } }],
    });
  } else if (process.env.WHATSAPP_ORDER_STATUS_INCLUDE_TEXT_HEADER_PARAM === "true") {
    /* Meta template: TEXT header with a single {{1}} — we send order ref. Omit if header is static only (set in Meta, no API component). */
    components.push({
      type: "header",
      parameters: [{ type: "text", text: orderRef }],
    });
  }

  components.push({
    type: "body",
    parameters: [
      { type: "text", text: orderRef },
      { type: "text", text: customerName },
    ],
  });

  return {
    name: templateName,
    language: { code: languageCode },
    components,
  };
}

function templateNameForStatus(status: string): string {
  switch (status) {
    case "shipped":
      return readEnvName("WHATSAPP_TEMPLATE_ORDER_SHIPPED");
    case "delivered":
      return readEnvName("WHATSAPP_TEMPLATE_ORDER_DELIVERED");
    default:
      return "";
  }
}

/**
 * Sends an approved WhatsApp template when admin advances fulfillment status.
 *
 * Meta: optional HEADER/FOOTER in template editor; BODY {{1}} order ref, {{2}} customer name.
 *
 * Env (only two templates — shipped & delivered):
 * - WHATSAPP_TEMPLATE_ORDER_SHIPPED, WHATSAPP_TEMPLATE_ORDER_DELIVERED — names exactly as in WhatsApp Manager.
 * - WHATSAPP_TEMPLATE_ORDER_LANGUAGE — preferred: locale for these two only (e.g. en_US). Falls back to WHATSAPP_TEMPLATE_LANGUAGE, then en.
 * - WHATSAPP_ORDER_STATUS_HEADER_IMAGE_URL — public https image; if set, template must use IMAGE header in Meta.
 * - WHATSAPP_ORDER_STATUS_INCLUDE_TEXT_HEADER_PARAM=true — only if Meta template has TEXT header with {{1}}; we send orderRef.
 */
export async function notifyCustomerOrderStatusChange(
  order: {
    phoneNumber: string;
    customerName: string;
    businessOrderId?: string;
    orderStatus: string;
    _id?: unknown;
  },
  previousStatus: string,
): Promise<void> {
  if (order.orderStatus === previousStatus) return;
  if (!NOTIFY_STATUSES.has(order.orderStatus)) return;

  const templateName = templateNameForStatus(order.orderStatus);
  if (!templateName) {
    logger.info("whatsapp.order_status", "no template env for status — skipping", {
      orderStatus: order.orderStatus,
    });
    return;
  }

  const orderRef = order.businessOrderId?.trim() || String(order._id ?? "");
  const name = order.customerName?.trim() || "Customer";
  const languageCode = getOrderStatusTemplateLanguage();

  try {
    await sendTemplateMessage(
      order.phoneNumber,
      buildOrderStatusTemplatePayload(templateName, languageCode, orderRef, name),
    );
    logger.info("whatsapp.order_status", "template sent", {
      orderRef,
      orderStatus: order.orderStatus,
      templateName,
      language: languageCode,
    });
  } catch (error) {
    logger.warn("whatsapp.order_status", "template send failed (non-fatal)", {
      orderRef,
      orderStatus: order.orderStatus,
      templateName,
      language: languageCode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
