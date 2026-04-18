import { detectIntent } from "@/lib/bot/intentDetector";
import { createPaymentLink } from "@/lib/payments/razorpay";
import { logger } from "@/lib/utils/logger";
import { isValidPhone } from "@/lib/utils/phone";
import { addItemToCart, getOrCreateCart } from "@/lib/services/cartService";
import {
  createOrderFromCart,
  getOrderForUserTrack,
  listOrdersForUserTrack,
  type OrderAddressInput,
} from "@/lib/services/orderService";
import { buildTrackOrderListRow, formatTrackOrderDetailFromOrder } from "@/lib/whatsapp/trackOrderCopy";
import { buildAddressFromPinAndGeocode } from "@/lib/services/geocodingService";
import { formatProductList, getAllActiveProducts } from "@/lib/services/productService";
import {
  getSession,
  resetSession,
  updateSession,
  type SessionUpdates,
} from "@/lib/services/sessionService";
import {
  findOrCreateUser,
  getUserByPhone,
  updateUserAddress,
  updateUserAddressAtIndex,
  updateUserName,
} from "@/lib/services/userService";
import type { GeoCoordinates } from "@/lib/types/geo";

function pickGeo(
  address: { geolocation?: GeoCoordinates | null },
): GeoCoordinates | undefined {
  const g = address.geolocation;
  if (g == null || typeof g.latitude !== "number" || typeof g.longitude !== "number") {
    return undefined;
  }
  return { latitude: g.latitude, longitude: g.longitude };
}

type OrderProduct = {
  productId: string;
  name: string;
  price: number;
};

const CANCEL_WORDS = new Set(["cancel", "stop", "exit", "quit"]);

function withMenuHint(text: string) {
  return `${text}\n\nType "menu" for main menu or "cancel" to stop.`;
}

function parseQuantity(input: string) {
  const trimmed = input.trim().toLowerCase();
  const qtyMatch = /^qty:(\d{1,2})$/.exec(trimmed);
  if (qtyMatch) {
    return Number.parseInt(qtyMatch[1], 10);
  }
  return parseSelection(input);
}

function menuText(_name?: string) {
  return `Choose an option:\n1. Order\n2. Track\n\nReply with 1 or 2.`;
}

/** Greeting / fresh start — show welcome first, then main menu (handled in webhook). */
function shouldStartWithWelcomeThenMenu(cleanMessage: string) {
  const intent = detectIntent(cleanMessage);
  if (intent === "menu") return true;
  const t = cleanMessage.toLowerCase().trim();
  if (t === "menu" || t === "start") return true;
  if (/^good\s+(morning|afternoon|evening)\b/.test(t)) return true;
  return false;
}

function toAddressInput(address: {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  geolocation?: GeoCoordinates | null;
}): OrderAddressInput {
  const geo = pickGeo(address);
  return {
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    ...(geo ? { geolocation: geo } : {}),
  };
}

function formatAddressLine(address: {
  line1: string;
  city: string;
  postalCode: string;
  state?: string;
  country?: string;
  geolocation?: GeoCoordinates | null;
}) {
  const parts = [address.line1, address.city, address.postalCode, address.state, address.country].filter(Boolean);
  const line = parts.join(", ");
  return pickGeo(address) ? `${line} 📍` : line;
}

function addressSelectionText(addresses: Array<{
  line1: string;
  city: string;
  postalCode: string;
  state?: string;
  country?: string;
  geolocation?: GeoCoordinates | null;
}>) {
  if (addresses.length === 0) {
    return `No saved addresses yet.\nSend one line with commas — ${addressCommaFormatSummary()} — or a map pin 📍.`;
  }

  return `Choose address option:\n1. Use existing address\n2. Add new address\n3. Edit existing address\n\nSaved addresses:\n${addresses
    .map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`)
    .join("\n")}`;
}

function parseSelection(input: string) {
  const n = Number.parseInt(input.trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeName(input: string) {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length < 2 || cleaned.length > 60) return "";
  return cleaned;
}

function readTempData(tempData: unknown) {
  if (!tempData || typeof tempData !== "object") return {} as Record<string, unknown>;
  return tempData as Record<string, unknown>;
}

async function beginTrackOrderFlow(phone: string, user: { userId: string }): Promise<BotReply | string> {
  const orders = await listOrdersForUserTrack(user.userId);
  if (orders.length === 0) {
    await updateSession(phone, { currentFlow: null, step: "menu", tempData: {} });
    return withMenuHint("You don't have any orders yet.\n\nWhen you place an order, it will show up here.");
  }

  await updateSession(phone, { currentFlow: "track", step: "track_pick_order", tempData: {} });
  const options = orders.map((o) => {
    const ref = (o.businessOrderId?.trim() || String(o._id)) as string;
    return buildTrackOrderListRow({
      orderId: ref,
      totalAmount: o.orderValue,
      items: o.items.map((i) => ({ name: i.productName, quantity: i.quantity })),
      createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
    });
  });

  return { kind: "track_orders_menu", options };
}

/** line1, city, PIN, state (optional), country (optional) — comma-separated. */
function parseAddress(text: string): OrderAddressInput | null {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 3) return null;

  const line1 = parts[0];
  const city = parts[1];
  const postalCode = parts[2];
  if (line1.length < 2 || city.length < 2) return null;
  if (!isValidPostalCode(postalCode)) return null;

  return {
    line1,
    line2: "",
    city,
    postalCode,
    state: parts[3] ?? "",
    country: parts[4] ?? "India",
  };
}

type AddressCollectFor = "checkout_new" | "checkout_add" | "edit";

type LocationPin = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

type IncomingMessage =
  | string
  | {
      text?: string;
      location?: LocationPin;
    };

/** Plain text reply, or structured signal for the webhook (e.g. WhatsApp template). */
export type BotReply =
  | string
  | { kind: "goodbye_template"; name: string }
  | { kind: "welcome_then_menu"; name?: string }
  | { kind: "payment_link_cta"; orderId: string; payUrl: string }
  | {
      kind: "track_orders_menu";
      options: Array<{ id: string; title: string; description: string }>;
    };

export function isTrackOrdersMenu(
  reply: BotReply,
): reply is { kind: "track_orders_menu"; options: Array<{ id: string; title: string; description: string }> } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "track_orders_menu";
}

function isValidPostalCode(value: string) {
  const v = value.trim();
  if (/^\d{6}$/.test(v)) return true;
  if (v.length >= 4 && v.length <= 12) return true;
  return false;
}

function addressCommaFormatSummary() {
  return "line1, city, PIN code, state (optional), country (optional)";
}

function addressFullLinePrompt() {
  return withMenuHint(
    [
      "Send your full address in one line, comma-separated:",
      addressCommaFormatSummary(),
      "",
      "Example: 12 MG Road, Bengaluru, 560001, Karnataka, India",
      "",
      "Or send a map pin 📍 — we'll fill city / PIN when possible.",
    ].join("\n"),
  );
}

async function startAddressCollection(
  phone: string,
  baseTemp: Record<string, unknown>,
  forWhat: AddressCollectFor,
  editIndex?: number,
) {
  await updateSession(phone, {
    currentFlow: "order",
    step: "collect_address",
    tempData: {
      ...baseTemp,
      addressCollectFor: forWhat,
      ...(forWhat === "edit" && editIndex !== undefined ? { addressEditIndex: editIndex } : {}),
    },
  });
}

async function finalizeAddressCollection(
  phone: string,
  user: { userId: string },
  built: OrderAddressInput,
  collectFor: AddressCollectFor,
  editIndex: number,
) {
  if (collectFor === "edit" && editIndex >= 0) {
    const updatedUser = await updateUserAddressAtIndex(user.userId, editIndex, built);
    await updateSession(phone, {
      step: "address_selection",
      tempData: { addressSelectionMode: "use_pick" },
    });
    return withMenuHint(`Address updated.\nNow choose an address:\n${(updatedUser?.addresses ?? [])
      .map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`)
      .join("\n")}`);
  }

  await updateUserAddress(user.userId, built);
  const cart = await getOrCreateCart(user.userId);
  await updateSession(phone, {
    step: "checkout",
    tempData: { selectedAddress: built },
  });
  return withMenuHint(`Address saved.\n\nConfirm your order?\nTotal: ₹${new Intl.NumberFormat("en-IN").format(
    cart.totalAmount,
  )}\nReply yes to confirm or no to cancel.`);
}

async function getSelectableProducts(): Promise<OrderProduct[]> {
  const products = await getAllActiveProducts();
  return products.map((p) => ({
    productId: p.productId,
    name: p.name,
    price: p.price,
  }));
}

async function showProductsAndMoveToSelect(phone: string) {
  const products = await getSelectableProducts();

  if (products.length === 0) {
    await updateSession(phone, { step: "show_products" });
    return withMenuHint("No products available right now. Please try again later.");
  }

  await updateSession(phone, { step: "select_product" });

  return withMenuHint(`Available products:\n${formatProductList(products)}\n\nChoose a product from the list.`);
}

async function setSessionAndReply(phone: string, updates: SessionUpdates, text: string) {
  await updateSession(phone, updates);
  return text;
}

export async function handleMessage(phone: string, message: IncomingMessage): Promise<BotReply> {
  if (!isValidPhone(phone)) {
    logger.warn("bot.flow", "invalid phone received", { phone });
    return "Invalid phone number.";
  }

  const location = typeof message === "object" && message && "location" in message ? message.location : undefined;
  const textInput = typeof message === "string" ? message : (message.text ?? "");
  const cleanMessage = textInput.trim();
  const lowered = cleanMessage.toLowerCase();
  logger.info("bot.flow", "incoming message", { phone, message: cleanMessage, hasLocation: Boolean(location) });

  if (!cleanMessage && !location) {
    return "Please send a message.\n\nType hi to see menu.";
  }

  if (CANCEL_WORDS.has(lowered)) {
    let goodbyeName = "there";
    try {
      const existing = await getUserByPhone(phone);
      if (existing?.name?.trim()) {
        goodbyeName = existing.name.trim();
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "unknown";
      logger.warn("bot.flow", "could not load user for goodbye template", { phone, error: messageText });
    }
    await resetSession(phone);
    logger.info("bot.flow", "session cancelled", { phone });
    return { kind: "goodbye_template", name: goodbyeName };
  }

  let user;
  let session;
  try {
    user = await getUserByPhone(phone);
    if (!user) {
      await findOrCreateUser(phone);
      await updateSession(phone, { currentFlow: null, step: "ask_name", tempData: {} });
      return "Welcome to Pure Harvest! Before we continue, may I know your name?";
    }
    session = await getSession(phone);

    /** After payment: next message should thank the user instead of reopening the product list. */
    if (session.step === "post_payment_thanks") {
      if (shouldStartWithWelcomeThenMenu(cleanMessage) || lowered === "menu") {
        await resetSession(phone);
        await updateSession(phone, { currentFlow: null, step: "menu", tempData: {} });
        return { kind: "welcome_then_menu", name: user.name };
      }
      const trackIntent = detectIntent(cleanMessage);
      if (trackIntent === "track" || cleanMessage === "2") {
        await resetSession(phone);
        return beginTrackOrderFlow(phone, user);
      }
      await resetSession(phone);
      return { kind: "goodbye_template", name: user.name?.trim() || "there" };
    }

    if (lowered === "menu" && session.currentFlow) {
      await resetSession(phone);
      await updateSession(phone, { currentFlow: null, step: "menu", tempData: {} });
      return menuText(user.name);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("bot.flow", "failed to initialize user/session", { phone, error: message });
    return "Something went wrong while loading your session. Please try again.";
  }

  if (session.step === "ask_name") {
    const name = normalizeName(cleanMessage);
    if (!name) {
      return withMenuHint("Please share a valid name (at least 2 characters).");
    }

    await updateUserName(user.userId, name);
    await updateSession(phone, { currentFlow: null, step: "menu", tempData: {} });
    logger.info("bot.flow", "user name captured", { phone, name });
    return { kind: "welcome_then_menu", name };
  }

  if (!user.name?.trim()) {
    await updateSession(phone, { currentFlow: null, step: "ask_name", tempData: {} });
    return withMenuHint("Before we continue, may I know your name?");
  }

  if (session.step === "collect_address") {
    const tempData = readTempData(session.tempData);
    const collectFor = tempData.addressCollectFor as AddressCollectFor | undefined;
    const editIndex =
      typeof tempData.addressEditIndex === "number" && Number.isInteger(tempData.addressEditIndex)
        ? tempData.addressEditIndex
        : -1;

    if (!collectFor) {
      await updateSession(phone, { step: "address_selection", tempData: {} });
      return addressSelectionText(user.addresses ?? []);
    }

    if (location) {
      let auto: OrderAddressInput | null = null;
      try {
        auto = await buildAddressFromPinAndGeocode(location);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        logger.warn("bot.flow", "address auto-resolve from pin failed", { phone, error: message });
      }

      if (auto) {
        return finalizeAddressCollection(phone, user, auto, collectFor, editIndex);
      }

      return withMenuHint(
        [
          "We couldn't fill your address from the map pin.",
          `Please send it in one line with commas: ${addressCommaFormatSummary()}`,
          "Example: 12 MG Road, Bengaluru, 560001, Karnataka, India",
        ].join("\n"),
      );
    }

    const parsed = parseAddress(cleanMessage);
    if (parsed) {
      return finalizeAddressCollection(phone, user, parsed, collectFor, editIndex);
    }

    return withMenuHint(
      [
        "Send your address as one line, comma-separated:",
        addressCommaFormatSummary(),
        "",
        "Example: 12 MG Road, Bengaluru, 560001, Karnataka, India",
      ].join("\n"),
    );
  }

  if (session.step === "menu") {
    if (cleanMessage !== "1" && cleanMessage !== "2") {
      return menuText(user.name);
    }
  }

  if (!session.currentFlow) {
    const intent = detectIntent(cleanMessage);

    if (intent === "order" || cleanMessage === "1") {
      await updateSession(phone, { currentFlow: "order", step: "ordering", tempData: {} });
      return showProductsAndMoveToSelect(phone);
    }

    if (intent === "track" || cleanMessage === "2") {
      return beginTrackOrderFlow(phone, user);
    }

    if (shouldStartWithWelcomeThenMenu(cleanMessage)) {
      await updateSession(phone, { currentFlow: null, step: "menu", tempData: {} });
      return { kind: "welcome_then_menu", name: user.name };
    }

    return menuText(user.name);
  }

  if (session.currentFlow === "track") {
    if (session.step === "ask_order_id") {
      return beginTrackOrderFlow(phone, user);
    }

    if (session.step === "track_pick_order") {
      const order = await getOrderForUserTrack(cleanMessage, user.userId);
      if (!order) {
        return withMenuHint(
          "We couldn't match that selection. Tap an order from the list above, or type cancel.",
        );
      }

      const detail = formatTrackOrderDetailFromOrder(order);
      await resetSession(phone);
      return detail;
    }

    return beginTrackOrderFlow(phone, user);
  }

  // ORDER FLOW
  if (session.step === "ordering" || session.step === "show_products") {
    return showProductsAndMoveToSelect(phone);
  }

  if (session.step === "select_product") {
    const products = await getSelectableProducts();
    const byId = products.find((product) => product.productId === cleanMessage);
    const selectedIndex = parseSelection(cleanMessage) - 1;
    const byIndex =
      Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < products.length
        ? products[selectedIndex]
        : undefined;
    const selectedProduct = byId ?? byIndex;
    if (!selectedProduct) {
      return withMenuHint("Invalid product selection. Please choose a product from the list.");
    }
    const tempData = readTempData(session.tempData);
    await updateSession(phone, {
      step: "ask_quantity",
      tempData: { ...tempData, selectedProduct },
    });

    return `Selected: ${selectedProduct.name} (${formatProductList([selectedProduct]).replace(
      "1. ",
      "",
    )})\n\nChoose quantity from the list (1 to 10).`;
  }

  if (session.step === "ask_quantity") {
    const qty = parseQuantity(cleanMessage);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 10) {
      return "Invalid quantity. Please choose quantity from 1 to 10.";
    }

    const tempData = readTempData(session.tempData);
    const selectedProduct = tempData.selectedProduct as OrderProduct | undefined;
    if (!selectedProduct) {
      await updateSession(phone, { step: "show_products" });
      return showProductsAndMoveToSelect(phone);
    }

    let cart;
    try {
      await addItemToCart(user.userId, selectedProduct, qty);
      cart = await getOrCreateCart(user.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logger.error("bot.flow", "failed to add item to cart", {
        phone,
        productId: selectedProduct.productId,
        qty,
        error: message,
      });
      return "Could not add item to cart. Please try again.";
    }

    const savedAddresses = user.addresses ?? [];
    if (savedAddresses.length === 0) {
      await startAddressCollection(phone, {}, "checkout_new");
      return `Added ${qty} x ${selectedProduct.name}.\nCart total: ₹${new Intl.NumberFormat("en-IN").format(
        cart.totalAmount,
      )}\n\n${addressFullLinePrompt()}`;
    }

    await updateSession(phone, { step: "address_selection", tempData: {} });
    return `Added ${qty} x ${selectedProduct.name}.\nCart total: ₹${new Intl.NumberFormat("en-IN").format(
      cart.totalAmount,
    )}\n\n${addressSelectionText(savedAddresses)}`;
  }

  if (session.step === "address_selection") {
    const addresses = user.addresses ?? [];
    const tempData = readTempData(session.tempData);
    const mode = typeof tempData.addressSelectionMode === "string" ? tempData.addressSelectionMode : "";

    if (mode === "use_pick") {
      const choice = parseSelection(cleanMessage);
      if (!Number.isInteger(choice) || choice <= 0 || choice > addresses.length) {
      return withMenuHint(`Invalid selection.\nChoose an address number:\n${addresses
          .map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`)
          .join("\n")}`);
      }

      const selectedAddress = toAddressInput(addresses[choice - 1]);
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, {
        step: "checkout",
        tempData: { selectedAddress },
      });
      return withMenuHint(`Selected address:\n${formatAddressLine(selectedAddress)}\n\nConfirm your order?\nTotal: ₹${new Intl.NumberFormat(
        "en-IN",
      ).format(cart.totalAmount)}\nReply yes to confirm or no to cancel.`);
    }

    if (mode === "add_new") {
      await startAddressCollection(phone, readTempData(session.tempData), "checkout_add");
      return addressFullLinePrompt();
    }

    if (mode === "edit_pick") {
      const choice = parseSelection(cleanMessage);
      if (!Number.isInteger(choice) || choice <= 0 || choice > addresses.length) {
        return withMenuHint(`Invalid selection.\nChoose address number to edit:\n${addresses
          .map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`)
          .join("\n")}`);
      }

      await startAddressCollection(phone, readTempData(session.tempData), "edit", choice - 1);
      return withMenuHint(
        [
          `You're editing saved address ${choice}.`,
          `Send one line: ${addressCommaFormatSummary()}`,
          "",
          "Example: 12 MG Road, Bengaluru, 560001, Karnataka, India",
          "",
          "Or send a map pin 📍.",
        ].join("\n"),
      );
    }

    if (addresses.length === 0) {
      await startAddressCollection(phone, readTempData(session.tempData), "checkout_new");
      return addressFullLinePrompt();
    }

    if (cleanMessage === "1") {
      return withMenuHint(
        await setSessionAndReply(
        phone,
        { step: "address_selection", tempData: { addressSelectionMode: "use_pick" } },
        `Choose an address number:\n${addresses.map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`).join("\n")}`,
        ),
      );
    }
    if (cleanMessage === "2") {
      await startAddressCollection(phone, {}, "checkout_add");
      return addressFullLinePrompt();
    }
    if (cleanMessage === "3") {
      return withMenuHint(
        await setSessionAndReply(
        phone,
        { step: "address_selection", tempData: { addressSelectionMode: "edit_pick" } },
        `Choose address number to edit:\n${addresses
          .map((addr, idx) => `${idx + 1}. ${formatAddressLine(addr)}`)
          .join("\n")}`,
        ),
      );
    }

    const parsedDirect = parseAddress(cleanMessage);
    if (parsedDirect) {
      await updateUserAddress(user.userId, parsedDirect);
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, {
        step: "checkout",
        tempData: { selectedAddress: parsedDirect },
      });
      return withMenuHint(`Address saved.\n\nConfirm your order?\nTotal: ₹${new Intl.NumberFormat("en-IN").format(
        cart.totalAmount,
      )}\nReply yes to confirm or no to cancel.`);
    }

    return addressSelectionText(addresses);
  }

  if (session.step === "checkout") {
    const tempData = readTempData(session.tempData);
    let address = tempData.selectedAddress as OrderAddressInput | undefined;

    if (!address) {
      await updateSession(phone, { step: "address_selection", tempData: {} });
      return addressSelectionText(user.addresses ?? []);
    }

    if (["no", "n"].includes(lowered)) {
      await resetSession(phone);
      return `Order cancelled.\n\n${menuText(user.name)}`;
    }

    if (!["yes", "y", "confirm"].includes(lowered)) {
      const cart = await getOrCreateCart(user.userId);
      const nextTempData = readTempData(session.tempData);
      await updateSession(phone, {
        step: "checkout",
        tempData: { ...nextTempData, selectedAddress: address },
      });
      return withMenuHint(
        `Confirm your order?\nTotal: ₹${new Intl.NumberFormat("en-IN").format(cart.totalAmount)}\nReply yes to confirm or no to cancel.`,
      );
    }

    await updateSession(phone, { step: "generate_payment_link" });

    let order;
    let paymentLink;
    try {
      order = await createOrderFromCart(user.userId, address);
      paymentLink = await createPaymentLink({
        orderId: order.orderId,
        userId: order.userId,
        totalAmount: order.totalAmount,
        phone: user.phone,
        name: user.name || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logger.error("bot.flow", "order/payment creation failed", { phone, error: message });
      await resetSession(phone);
      return "Could not create order right now. Please try again later.";
    }

    const link =
      typeof paymentLink === "object" &&
      paymentLink &&
      "short_url" in paymentLink &&
      typeof paymentLink.short_url === "string"
        ? paymentLink.short_url
        : "";

    await resetSession(phone);
    logger.info("bot.flow", "order created", { phone, orderId: order.orderId });
    if (link) {
      return { kind: "payment_link_cta", orderId: order.orderId, payUrl: link };
    }
    return `Order created successfully!\nOrder ID: ${order.orderId}\nPayment link generated. Please check your WhatsApp notifications.`;
  }

  if (session.step === "generate_payment_link") {
    return "Please wait while we generate your payment link...";
  }

  await resetSession(phone);
  return menuText(user.name);
}

