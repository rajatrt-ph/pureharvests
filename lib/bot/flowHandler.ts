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
import { formatProductList, getActiveProductByProductId, getAllActiveProducts } from "@/lib/services/productService";
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
  /** Stock on hand when the user picked the product (refreshed again at quantity step). */
  stock: number;
};

const MAX_UNITS_PER_LINE = 10;

/** Shown when DB stock for this SKU is zero (or product inactive / missing). */
const NO_STOCK_FOR_PRODUCT = "No stock available for this product.";

function formatInrCartTotal(total: number) {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(total)}`;
}

type CartMenuLine = { name: string; quantity: number; price: number };

function formatCartItemsBlock(items: CartMenuLine[]): string {
  if (!items.length) return "";
  const lines = items.map(
    (it) => `• ${it.name} × ${it.quantity} — ${formatInrCartTotal(it.price * it.quantity)}`,
  );
  return `*Your cart:*\n${lines.join("\n")}`;
}

/** Shared copy for “add more vs go to address” (after add-to-cart or stock/cart dead-ends). */
function buildCartContinueMenuBody(options: {
  items: CartMenuLine[];
  cartTotal: number;
  /** Optional lead (e.g. stock message) shown above the cart list. */
  note?: string;
}): string {
  const { items, cartTotal, note } = options;
  const totalStr = formatInrCartTotal(cartTotal);
  const core = [
    "What would you like to do next?",
    "1. Add another product",
    `2. Continue to delivery — Cart total: ${totalStr}`,
  ].join("\n");
  const cartBlock = formatCartItemsBlock(items);
  const parts = [note?.trim(), cartBlock, core].filter((p) => p && p.length > 0);
  return parts.join("\n\n");
}

function cartLinesForContinueMenu(cart: { items: CartMenuLine[] }): CartMenuLine[] {
  return cart.items.map(({ name, quantity, price }) => ({ name, quantity, price }));
}

function wantsAddAnotherProductChoice(cleanMessage: string): boolean {
  const t = cleanMessage.trim().toLowerCase();
  if (t === "1") return true;
  if (t === "add another product") return true;
  if (/\badd\s+(another|more)\b/.test(t)) return true;
  if (/\banother\s+product\b/.test(t)) return true;
  if (t === "more") return true;
  return false;
}

function wantsContinueToDeliveryChoice(cleanMessage: string): boolean {
  const t = cleanMessage.trim().toLowerCase();
  if (t === "2") return true;
  if (t === "checkout" || t === "delivery" || t === "address") return true;
  if (/\bcontinue\s+to\s+(delivery|checkout)\b/.test(t)) return true;
  if (/\bgo\s+to\s+(checkout|delivery)\b/.test(t)) return true;
  if (/\b(proceed|continue)\b/.test(t) && /\b(checkout|delivery|order|address)\b/.test(t)) return true;
  if (t === "done" || t === "finish" || t === "next") return true;
  return false;
}

async function computeAvailableUnits(userId: string, productId: string, stock: number): Promise<number> {
  const cart = await getOrCreateCart(userId);
  const inCart = cart.items.find((item) => item.productId === productId)?.quantity ?? 0;
  const remaining = stock - inCart;
  if (remaining <= 0) return 0;
  return Math.min(MAX_UNITS_PER_LINE, remaining);
}

const CANCEL_WORDS = new Set(["cancel", "stop", "exit", "quit"]);

function withMenuHint(text: string) {
  return `${text}\n\nType "menu" for main menu or "cancel" to stop.`;
}

function parseQuantity(input: string, maxQty = MAX_UNITS_PER_LINE) {
  const cap = Math.max(1, Math.min(MAX_UNITS_PER_LINE, maxQty));
  const trimmed = input.trim().toLowerCase();
  const qtyMatch = /^qty:(\d{1,2})$/.exec(trimmed);
  const n = qtyMatch ? Number.parseInt(qtyMatch[1], 10) : parseSelection(input);
  if (!Number.isInteger(n) || n <= 0 || n > cap) return NaN;
  return n;
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

type SavedAddressRow = {
  line1: string;
  city: string;
  postalCode: string;
  state?: string;
  country?: string;
  geolocation?: GeoCoordinates | null;
};

/** WhatsApp list row limits: title 24, description 72 (approx). */
function buildAddressPickMenuOptions(addresses: SavedAddressRow[]) {
  return addresses.slice(0, 10).map((addr, idx) => {
    const line = formatAddressLine(addr);
    return {
      id: `addr:${idx}`,
      title: `Address ${idx + 1}`.slice(0, 24),
      description: line.slice(0, 72),
    };
  });
}

/** List id `addr:0` or typed digit 1…N (1-based). Returns 0-based index or null. */
function parseAddressListSelection(input: string, length: number): number | null {
  const t = input.trim();
  const m = /^addr:(\d+)$/i.exec(t);
  if (m) {
    const i = Number.parseInt(m[1], 10);
    if (Number.isInteger(i) && i >= 0 && i < length) return i;
    return null;
  }
  const n = Number.parseInt(t, 10);
  if (Number.isInteger(n) && n >= 1 && n <= length) return n - 1;
  return null;
}

function buildAddressActionMenuBody(addresses: SavedAddressRow[], cartTotalLine?: string) {
  const n = addresses.length;
  const preview =
    n === 0
      ? ""
      : n <= 4
        ? addresses.map((a) => `• ${formatAddressLine(a)}`).join("\n")
        : `You have ${n} saved addresses — tap *Use existing* to pick one on the next screen.`;
  const parts = [
    cartTotalLine,
    preview,
    "Choose an option below.",
  ].filter((p) => p && String(p).trim().length > 0);
  return parts.join("\n\n").slice(0, 1000);
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
    }
  | { kind: "quantity_menu"; maxQty: number; body: string }
  | { kind: "cart_continue_menu"; body: string; cartTotal: number }
  /** Delivery step: Use existing / Add new / Edit (list ids 1–3). */
  | { kind: "address_action_menu"; body: string }
  /** Pick which saved address (list ids addr:0 …). */
  | {
      kind: "address_pick_menu";
      purpose: "use" | "edit";
      body: string;
      options: Array<{ id: string; title: string; description: string }>;
    };

export function isCartContinueMenu(
  reply: BotReply,
): reply is { kind: "cart_continue_menu"; body: string; cartTotal: number } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "cart_continue_menu";
}

export function isQuantityMenu(
  reply: BotReply,
): reply is { kind: "quantity_menu"; maxQty: number; body: string } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "quantity_menu";
}

export function isTrackOrdersMenu(
  reply: BotReply,
): reply is { kind: "track_orders_menu"; options: Array<{ id: string; title: string; description: string }> } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "track_orders_menu";
}

export function isAddressActionMenu(
  reply: BotReply,
): reply is { kind: "address_action_menu"; body: string } {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "address_action_menu";
}

export function isAddressPickMenu(
  reply: BotReply,
): reply is {
  kind: "address_pick_menu";
  purpose: "use" | "edit";
  body: string;
  options: Array<{ id: string; title: string; description: string }>;
} {
  return typeof reply === "object" && reply !== null && "kind" in reply && reply.kind === "address_pick_menu";
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
): Promise<BotReply | string> {
  if (collectFor === "edit" && editIndex >= 0) {
    const updatedUser = await updateUserAddressAtIndex(user.userId, editIndex, built);
    await updateSession(phone, {
      step: "address_selection",
      tempData: { addressSelectionMode: "use_pick" },
    });
    const addrs = (updatedUser?.addresses ?? []) as SavedAddressRow[];
    return {
      kind: "address_pick_menu",
      purpose: "use",
      body: "Address updated.\nNow choose a delivery address:",
      options: buildAddressPickMenuOptions(addrs),
    };
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
    stock: typeof p.stock === "number" ? p.stock : 0,
  }));
}

async function showProductsAndMoveToSelect(phone: string) {
  const products = await getSelectableProducts();

  if (products.length === 0) {
    await updateSession(phone, { currentFlow: "order", step: "show_products" });
    return withMenuHint("No products available right now. Please try again later.");
  }

  await updateSession(phone, { currentFlow: "order", step: "select_product" });

  return withMenuHint(`Available products:\n${formatProductList(products)}\n\nChoose a product from the list.`);
}

type UserForDelivery = {
  userId: string;
  addresses?: Array<{
    line1: string;
    city: string;
    postalCode: string;
    state?: string;
    country?: string;
    line2?: string;
    geolocation?: GeoCoordinates | null;
  }>;
};

async function proceedToDeliveryAfterCart(
  phone: string,
  user: UserForDelivery,
  cart: Awaited<ReturnType<typeof getOrCreateCart>>,
): Promise<BotReply | string> {
  if (!cart.items.length) {
    await updateSession(phone, { currentFlow: "order", step: "show_products", tempData: {} });
    return showProductsAndMoveToSelect(phone);
  }

  const totalFmt = formatInrCartTotal(cart.totalAmount);
  const savedAddresses = user.addresses ?? [];
  if (savedAddresses.length === 0) {
    await startAddressCollection(phone, {}, "checkout_new");
    return `Cart total: ${totalFmt}.\n\n${addressFullLinePrompt()}`;
  }

  await updateSession(phone, { currentFlow: "order", step: "address_selection", tempData: {} });
  return {
    kind: "address_action_menu",
    body: buildAddressActionMenuBody(savedAddresses as SavedAddressRow[], `Cart total: ${totalFmt}`),
  };
}

export async function handleMessage(phone: string, message: IncomingMessage): Promise<BotReply | string> {
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
      const addrs = (user.addresses ?? []) as SavedAddressRow[];
      if (addrs.length === 0) return addressFullLinePrompt();
      return {
        kind: "address_action_menu",
        body: buildAddressActionMenuBody(addrs),
      };
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
    const picked = byId ?? byIndex;
    if (!picked) {
      return withMenuHint("Invalid product selection. Please choose a product from the list.");
    }

    const fresh = await getActiveProductByProductId(picked.productId);
    if (!fresh || !fresh.stock || fresh.stock < 1) {
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, { currentFlow: "order", step: "choose_add_or_checkout", tempData: {} });
      return {
        kind: "cart_continue_menu",
        body: buildCartContinueMenuBody({
          items: cartLinesForContinueMenu(cart),
          cartTotal: cart.totalAmount,
          note: `${NO_STOCK_FOR_PRODUCT} Please pick another product, or continue.`,
        }),
        cartTotal: cart.totalAmount,
      };
    }

    const selectedProduct: OrderProduct = {
      productId: fresh.productId,
      name: fresh.name,
      price: fresh.price,
      stock: fresh.stock,
    };

    const maxQuantity = await computeAvailableUnits(user.userId, selectedProduct.productId, selectedProduct.stock);
    if (maxQuantity <= 0) {
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, { currentFlow: "order", step: "choose_add_or_checkout", tempData: {} });
      return {
        kind: "cart_continue_menu",
        body: buildCartContinueMenuBody({
          items: cartLinesForContinueMenu(cart),
          cartTotal: cart.totalAmount,
          note: "You already have all available units of this product in your cart.",
        }),
        cartTotal: cart.totalAmount,
      };
    }

    const tempData = readTempData(session.tempData);
    await updateSession(phone, {
      step: "ask_quantity",
      tempData: { ...tempData, selectedProduct, maxQuantity },
    });

    const summary = `Selected: ${selectedProduct.name} (${formatProductList([selectedProduct]).replace("1. ", "")})`;
    const body = `${summary}\n\nChoose quantity from the list (1 to ${maxQuantity}).`;

    return { kind: "quantity_menu", maxQty: maxQuantity, body };
  }

  if (session.step === "ask_quantity") {
    const tempData = readTempData(session.tempData);
    const selectedProduct = tempData.selectedProduct as OrderProduct | undefined;
    const sessionMax = tempData.maxQuantity;
    let maxQty =
      typeof sessionMax === "number" && Number.isInteger(sessionMax) && sessionMax > 0
        ? Math.min(MAX_UNITS_PER_LINE, sessionMax)
        : MAX_UNITS_PER_LINE;

    if (!selectedProduct) {
      await updateSession(phone, { step: "show_products" });
      return showProductsAndMoveToSelect(phone);
    }

    const fresh = await getActiveProductByProductId(selectedProduct.productId);
    if (!fresh || !fresh.stock || fresh.stock < 1) {
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, { currentFlow: "order", step: "choose_add_or_checkout", tempData: {} });
      return {
        kind: "cart_continue_menu",
        body: buildCartContinueMenuBody({
          items: cartLinesForContinueMenu(cart),
          cartTotal: cart.totalAmount,
          note: `${NO_STOCK_FOR_PRODUCT} Please pick another product, or continue.`,
        }),
        cartTotal: cart.totalAmount,
      };
    }

    maxQty = await computeAvailableUnits(user.userId, selectedProduct.productId, fresh.stock);
    if (maxQty <= 0) {
      const cart = await getOrCreateCart(user.userId);
      await updateSession(phone, { currentFlow: "order", step: "choose_add_or_checkout", tempData: {} });
      return {
        kind: "cart_continue_menu",
        body: buildCartContinueMenuBody({
          items: cartLinesForContinueMenu(cart),
          cartTotal: cart.totalAmount,
          note: "You already have all available units of this product in your cart.",
        }),
        cartTotal: cart.totalAmount,
      };
    }

    const qty = parseQuantity(cleanMessage, maxQty);
    if (!Number.isInteger(qty)) {
      return `Invalid quantity. Please choose a number from 1 to ${maxQty}.`;
    }

    let cart;
    try {
      await addItemToCart(
        user.userId,
        {
          productId: selectedProduct.productId,
          name: selectedProduct.name,
          price: fresh.price,
        },
        qty,
      );
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

    await updateSession(phone, { currentFlow: "order", step: "choose_add_or_checkout", tempData: {} });
    return {
      kind: "cart_continue_menu",
      body: buildCartContinueMenuBody({
        items: cartLinesForContinueMenu(cart),
        cartTotal: cart.totalAmount,
      }),
      cartTotal: cart.totalAmount,
    };
  }

  if (session.step === "choose_add_or_checkout") {
    const cart = await getOrCreateCart(user.userId);

    if (wantsAddAnotherProductChoice(cleanMessage)) {
      await updateSession(phone, { currentFlow: "order", step: "select_product", tempData: {} });
      return showProductsAndMoveToSelect(phone);
    }

    if (wantsContinueToDeliveryChoice(cleanMessage)) {
      return proceedToDeliveryAfterCart(phone, user, cart);
    }

    return withMenuHint(
      `Reply *1* to add another product, or *2* to continue to delivery.\n\nCart total: ${formatInrCartTotal(cart.totalAmount)}.`,
    );
  }

  if (session.step === "address_selection") {
    const addresses = user.addresses ?? [];
    const tempData = readTempData(session.tempData);
    const mode = typeof tempData.addressSelectionMode === "string" ? tempData.addressSelectionMode : "";

    if (mode === "use_pick") {
      const idx = parseAddressListSelection(cleanMessage, addresses.length);
      if (idx === null) {
        return {
          kind: "address_pick_menu",
          purpose: "use",
          body: "That wasn't a valid choice.\nPick a delivery address:",
          options: buildAddressPickMenuOptions(addresses as SavedAddressRow[]),
        };
      }

      const selectedAddress = toAddressInput(addresses[idx]);
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
      const idx = parseAddressListSelection(cleanMessage, addresses.length);
      if (idx === null) {
        return {
          kind: "address_pick_menu",
          purpose: "edit",
          body: "That wasn't a valid choice.\nPick an address to edit:",
          options: buildAddressPickMenuOptions(addresses as SavedAddressRow[]),
        };
      }

      await startAddressCollection(phone, readTempData(session.tempData), "edit", idx);
      return withMenuHint(
        [
          `You're editing saved address ${idx + 1}.`,
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
      await updateSession(phone, { step: "address_selection", tempData: { addressSelectionMode: "use_pick" } });
      return {
        kind: "address_pick_menu",
        purpose: "use",
        body: "Choose a delivery address:",
        options: buildAddressPickMenuOptions(addresses as SavedAddressRow[]),
      };
    }
    if (cleanMessage === "2") {
      await startAddressCollection(phone, {}, "checkout_add");
      return addressFullLinePrompt();
    }
    if (cleanMessage === "3") {
      await updateSession(phone, { step: "address_selection", tempData: { addressSelectionMode: "edit_pick" } });
      return {
        kind: "address_pick_menu",
        purpose: "edit",
        body: "Choose an address to edit:",
        options: buildAddressPickMenuOptions(addresses as SavedAddressRow[]),
      };
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

    return {
      kind: "address_action_menu",
      body: buildAddressActionMenuBody(addresses as SavedAddressRow[]),
    };
  }

  if (session.step === "checkout") {
    const tempData = readTempData(session.tempData);
    let address = tempData.selectedAddress as OrderAddressInput | undefined;

    if (!address) {
      await updateSession(phone, { step: "address_selection", tempData: {} });
      const addrs = (user.addresses ?? []) as SavedAddressRow[];
      if (addrs.length === 0) {
        await startAddressCollection(phone, readTempData(session.tempData), "checkout_new");
        return addressFullLinePrompt();
      }
      const cart = await getOrCreateCart(user.userId);
      return {
        kind: "address_action_menu",
        body: buildAddressActionMenuBody(addrs, `Cart total: ${formatInrCartTotal(cart.totalAmount)}`),
      };
    }

    if (["no", "n"].includes(lowered)) {
      await resetSession(phone);
      logger.info("bot.flow", "order cancelled at checkout", { phone });
      return { kind: "goodbye_template", name: user.name?.trim() || "there" };
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

