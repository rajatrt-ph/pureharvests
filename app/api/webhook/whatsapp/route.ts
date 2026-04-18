import { NextResponse } from "next/server";

import {
  handleMessage,
  type BotReply,
  isAddressActionMenu,
  isAddressPickMenu,
  isCartContinueMenu,
  isQuantityMenu,
  isTrackOrdersMenu,
} from "@/lib/bot/flowHandler";
import { connectDB } from "@/lib/db";
import { getAllActiveProducts } from "@/lib/services/productService";
import { getUserByPhone } from "@/lib/services/userService";
import { logger } from "@/lib/utils/logger";
import { isValidPhone } from "@/lib/utils/phone";
import { formatGoodbyeMessage } from "@/lib/whatsapp/goodbyeCopy";
import { formatWelcomeMessage } from "@/lib/whatsapp/welcomeCopy";
import { sendMessage, sendTemplateMessage } from "@/lib/whatsapp/sendMessage";

function isGoodbyeTemplate(reply: BotReply): reply is { kind: "goodbye_template"; name: string } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "goodbye_template";
}

function isWelcomeThenMenu(reply: BotReply): reply is { kind: "welcome_then_menu"; name?: string } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "welcome_then_menu";
}

function isPaymentLinkCta(
  reply: BotReply,
): reply is {
  kind: "payment_link_cta";
  orderId: string;
  payUrl: string;
  body?: string;
  header?: string;
  footer?: string;
  buttonText?: string;
} {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "payment_link_cta";
}

/**
 * Goodbye: approved template (`WHATSAPP_GOODBYE_TEMPLATE_NAME`) or plain text.
 * Register the template body in Meta to match `META_GOODBYE_TEMPLATE_BODY_SNIPPET`
 * in `lib/whatsapp/goodbyeCopy.ts` — one variable {{1}} = full name.
 */
async function sendConversationGoodbyeTemplate(phone: string, displayName: string) {
  const name = displayName.trim() || "there";
  const templateName = process.env.WHATSAPP_GOODBYE_TEMPLATE_NAME?.trim();
  const lang = process.env.WHATSAPP_GOODBYE_TEMPLATE_LANG?.trim() || "en";

  if (!templateName) {
    logger.warn("whatsapp.webhook", "WHATSAPP_GOODBYE_TEMPLATE_NAME not set; sending plain text goodbye");
    await sendMessage(phone, formatGoodbyeMessage(name));
    return;
  }

  try {
    await sendTemplateMessage(phone, {
      name: templateName,
      language: { code: lang },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: name }],
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("whatsapp.webhook", "goodbye template failed; sending plain text once", { error: message });
    await sendMessage(phone, formatGoodbyeMessage(name));
  }
}

async function sendMainMenuInteractive(phone: string) {
  await sendMessage(phone, {
    type: "menu",
    header: "Menu",
    body: "Choose an option:",
    footer: "Reply anytime with cancel to stop",
    imageUrl: process.env.WHATSAPP_MENU_HEADER_IMAGE_URL,
    buttonText: "Choose",
    sectionTitle: "Options",
    options: [
      { id: "1", title: "Order", description: "Browse products and place order" },
      { id: "2", title: "Track", description: "Check your order status" },
    ],
  });
}

/**
 * Welcome step: either an approved WhatsApp template (`WHATSAPP_WELCOME_TEMPLATE_NAME`) or the same
 * copy as plain text. Register the template body in Meta to match
 * `META_WELCOME_TEMPLATE_BODY_SNIPPET` in `lib/whatsapp/welcomeCopy.ts` — one variable {{1}} = full name.
 */
async function sendWelcomeThenMenu(phone: string, name?: string) {
  const displayName = name?.trim() || "there";
  const templateName = process.env.WHATSAPP_WELCOME_TEMPLATE_NAME?.trim();
  const lang = process.env.WHATSAPP_WELCOME_TEMPLATE_LANG?.trim() || "en";

  if (templateName) {
    try {
      await sendTemplateMessage(phone, {
        name: templateName,
        language: { code: lang },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: displayName }],
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logger.error("whatsapp.webhook", "welcome template failed; sending plain text", { error: message });
      await sendMessage(phone, formatWelcomeMessage(displayName));
    }
  } else {
    await sendMessage(phone, formatWelcomeMessage(displayName));
  }

  await new Promise((r) => setTimeout(r, 500));

  await sendMainMenuInteractive(phone);
}

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: { body?: string };
          location?: { latitude: number; longitude: number; name?: string; address?: string };
          interactive?: {
            list_reply?: { id?: string; title?: string };
            button_reply?: { id?: string; title?: string };
          };
          type?: string;
        }>;
      };
    }>;
  }>;
};

function getIncomingMessage(payload: WhatsAppWebhookPayload) {
  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const phone = message?.from?.trim() ?? "";
  const text =
    message?.text?.body?.trim() ??
    message?.interactive?.list_reply?.id?.trim() ??
    message?.interactive?.list_reply?.title?.trim() ??
    message?.interactive?.button_reply?.id?.trim() ??
    message?.interactive?.button_reply?.title?.trim() ??
    "";
  const location =
    message?.type === "location" && message.location
      ? {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          name: message.location.name,
          address: message.location.address,
        }
      : undefined;
  return { phone, text, location };
}

function looksLikeMainMenu(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("choose an option") && normalized.includes("1. order") && normalized.includes("2. track");
}

function looksLikeProductPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("available products:") && normalized.includes("choose a product from the list");
}

function looksLikeQuantityPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return (
    normalized.includes("selected:") &&
    normalized.includes("choose quantity from the list") &&
    /\(\d{1,2} to \d{1,2}\)/.test(normalized)
  );
}

function looksLikeAddressActionPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("choose address option:") && normalized.includes("use existing address");
}

function looksLikeAddressPickPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("choose an address number:");
}

function looksLikeAddressEditPickPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("choose address number to edit:");
}

function looksLikeOrderConfirmationPrompt(reply: string) {
  const normalized = reply.toLowerCase();
  return normalized.includes("confirm your order?") && normalized.includes("reply yes to confirm or no to cancel");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token")?.trim() ?? "";
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
  const isValid = mode === "subscribe" && Boolean(token && verifyToken && token === verifyToken);

  if (isValid && challenge) {
    logger.info("whatsapp.webhook", "verification succeeded");
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  logger.warn("whatsapp.webhook", "verification failed", {
    mode,
    hasHubToken: Boolean(token),
    verifyTokenConfigured: Boolean(verifyToken),
  });
  if (!verifyToken) {
    logger.error(
      "whatsapp.webhook",
      "WHATSAPP_VERIFY_TOKEN is missing in env — add it in Vercel and match Meta’s Verify token exactly",
    );
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as WhatsAppWebhookPayload;
    const { phone, text, location } = getIncomingMessage(payload);

    if (!phone || (!text && !location) || !isValidPhone(phone)) {
      logger.warn("whatsapp.webhook", "skipping invalid incoming payload", {
        hasPhone: Boolean(phone),
        hasText: Boolean(text),
        hasLocation: Boolean(location),
      });
      return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
    }

    await connectDB();
    logger.info("whatsapp.webhook", "incoming message processed", { phone, text, hasLocation: Boolean(location) });

    const reply = await handleMessage(phone, { text: text ?? "", location });

    if (isGoodbyeTemplate(reply)) {
      await sendConversationGoodbyeTemplate(phone, reply.name);
      logger.info("whatsapp.webhook", "goodbye template sent", { phone });
    } else if (isWelcomeThenMenu(reply)) {
      await sendWelcomeThenMenu(phone, reply.name);
      logger.info("whatsapp.webhook", "welcome then menu sent", { phone });
    } else if (isPaymentLinkCta(reply)) {
      const defaultBody = `Order ${reply.orderId} is ready.\n\nTap the button below to complete payment with Razorpay. You'll get a confirmation here once it's paid.`;
      const hasCustomBody = Boolean(reply.body?.trim());
      const bodyText = reply.body?.trim() || defaultBody;
      const headerText =
        reply.header?.trim() ?? (hasCustomBody ? undefined : "Secure checkout");
      await sendMessage(phone, {
        type: "cta_url",
        ...(headerText ? { header: headerText } : {}),
        body: bodyText,
        footer: reply.footer ?? "Pure Harvests",
        buttonText: reply.buttonText?.trim() || "Pay now",
        url: reply.payUrl,
      });
      logger.info("whatsapp.webhook", "payment link CTA sent", { phone, orderId: reply.orderId });
    } else if (isTrackOrdersMenu(reply)) {
      await sendMessage(phone, {
        type: "menu",
        header: "Orders",
        body: "Choose an order to view payment status, delivery, and address.",
        buttonText: "View details",
        sectionTitle: "Your orders",
        options: reply.options,
      });
      logger.info("whatsapp.webhook", "track orders menu sent", { phone, count: reply.options.length });
    } else if (isQuantityMenu(reply)) {
      const max = Math.min(10, Math.max(1, reply.maxQty));
      await sendMessage(phone, {
        type: "menu",
        header: "Pure Harvest",
        body: reply.body,
        footer: max < 10 ? `Up to ${max} unit(s) available now` : "Up to 10 units per line",
        buttonText: "Select Quantity",
        sectionTitle: `Quantity (1–${max})`,
        options: Array.from({ length: max }, (_, idx) => {
          const qty = idx + 1;
          return {
            id: `qty:${qty}`,
            title: `${qty}`,
            description: qty === 1 ? "1 unit" : `${qty} units`,
          };
        }),
      });
      logger.info("whatsapp.webhook", "quantity menu sent", { phone, maxQty: max });
    } else if (isCartContinueMenu(reply)) {
      await sendMessage(phone, {
        type: "menu",
        header: "Your cart",
        body: reply.body,
        footer: `Total ₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(reply.cartTotal)} — tap or type 1 / 2`,
        buttonText: "Next step",
        sectionTitle: "Cart",
        options: [
          { id: "1", title: "Add another product", description: "Browse catalog again" },
          { id: "2", title: "Continue to delivery", description: "Address & checkout" },
        ],
      });
      logger.info("whatsapp.webhook", "cart continue menu sent", { phone, cartTotal: reply.cartTotal });
    } else if (isAddressActionMenu(reply)) {
      await sendMessage(phone, {
        type: "menu",
        header: "Delivery address",
        body: reply.body,
        footer: "Tap an option — or send cancel",
        buttonText: "Choose",
        sectionTitle: "Options",
        options: [
          { id: "1", title: "Use existing address", description: "Pick from saved list" },
          { id: "2", title: "Add new address", description: "Type or send a pin next" },
          { id: "3", title: "Edit saved address", description: "Update one you saved" },
        ],
      });
      logger.info("whatsapp.webhook", "address action menu sent", { phone });
    } else if (isAddressPickMenu(reply)) {
      await sendMessage(phone, {
        type: "menu",
        header: reply.purpose === "edit" ? "Edit address" : "Your addresses",
        body: reply.body,
        footer: "Tap a row below",
        buttonText: reply.purpose === "edit" ? "Pick to edit" : "Select address",
        sectionTitle: "Saved",
        options: reply.options,
      });
      logger.info("whatsapp.webhook", "address pick menu sent", { phone, purpose: reply.purpose });
    } else if (typeof reply === "string" && reply.trim()) {
      if (looksLikeMainMenu(reply)) {
        await sendMainMenuInteractive(phone);
      } else if (looksLikeProductPrompt(reply)) {
        const products = await getAllActiveProducts();
        const options = products.slice(0, 10).map((product) => ({
          id: product.productId,
          title: product.name,
          description: `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(product.price)}`,
        }));

        if (options.length > 0) {
          await sendMessage(phone, {
            type: "menu",
            header: "Pure Harvest",
            body: "Choose a product to add to your cart:",
            footer: "Reply anytime with cancel to stop",
            buttonText: "Select Product",
            sectionTitle: "Available Products",
            options,
          });
        } else {
          await sendMessage(phone, reply);
        }
      } else if (looksLikeQuantityPrompt(reply)) {
        await sendMessage(phone, {
          type: "menu",
          header: "Pure Harvest",
          body: "Select quantity:",
          footer: "Maximum 10 units per product",
          buttonText: "Select Quantity",
          sectionTitle: "Quantity (1-10)",
          options: Array.from({ length: 10 }, (_, idx) => {
            const qty = idx + 1;
            return {
              id: `qty:${qty}`,
              title: `${qty}`,
              description: qty === 1 ? "1 unit" : `${qty} units`,
            };
          }),
        });
      } else if (looksLikeAddressActionPrompt(reply)) {
        await sendMessage(phone, {
          type: "menu",
          header: "Pure Harvest",
          body: "Choose address option:",
          footer: "Reply anytime with cancel to stop",
          buttonText: "Address Options",
          sectionTitle: "Address Actions",
          options: [
            { id: "1", title: "Use Existing", description: "Select from saved addresses" },
            { id: "2", title: "Add New", description: "Add a new delivery address" },
            { id: "3", title: "Edit Existing", description: "Update a saved address" },
          ],
        });
      } else if (looksLikeAddressPickPrompt(reply) || looksLikeAddressEditPickPrompt(reply)) {
        const user = await getUserByPhone(phone);
        const addresses = user?.addresses ?? [];
        const options = addresses.slice(0, 10).map((addr, idx) => {
          const line = [addr.line1, addr.city, addr.postalCode].filter(Boolean).join(", ");
          const hasGeo =
            addr.geolocation &&
            typeof addr.geolocation.latitude === "number" &&
            typeof addr.geolocation.longitude === "number";
          const description = (hasGeo ? `${line.slice(0, 69)} 📍` : line).slice(0, 72);
          return {
            id: `${idx + 1}`,
            title: `Address ${idx + 1}`,
            description,
          };
        });

        if (options.length > 0) {
          await sendMessage(phone, {
            type: "menu",
            header: "Pure Harvest",
            body: looksLikeAddressEditPickPrompt(reply)
              ? "Choose address to edit:"
              : "Choose delivery address:",
            footer: "Reply anytime with cancel to stop",
            buttonText: looksLikeAddressEditPickPrompt(reply) ? "Edit Address" : "Select Address",
            sectionTitle: "Saved Addresses",
            options,
          });
        } else {
          await sendMessage(phone, reply);
        }
      } else if (looksLikeOrderConfirmationPrompt(reply)) {
        await sendMessage(phone, {
          type: "menu",
          header: "Pure Harvest",
          body: "Confirm your order:",
          footer: "Reply anytime with cancel to stop",
          buttonText: "Confirm Order",
          sectionTitle: "Confirmation",
          options: [
            { id: "yes", title: "Yes", description: "Place this order" },
            { id: "no", title: "No", description: "Cancel and return" },
          ],
        });
      } else {
        await sendMessage(phone, reply);
      }
      logger.info("whatsapp.webhook", "reply sent", { phone });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WhatsApp webhook error";
    logger.error("whatsapp.webhook", "processing failed", { error: message });
  }

  // Always return 200 as requested.
  return NextResponse.json({ ok: true }, { status: 200 });
}

