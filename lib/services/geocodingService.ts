import { logger } from "@/lib/utils/logger";
import type { OrderAddressInput } from "@/lib/services/orderService";

type NominatimReverseResponse = {
  display_name?: string;
  address?: Record<string, string | undefined>;
};

type LocationPin = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

function pickCity(addr: Record<string, string | undefined>) {
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.suburb ||
    addr.municipality ||
    addr.city_district ||
    addr.county ||
    ""
  ).trim();
}

function pickState(addr: Record<string, string | undefined>) {
  return (addr.state || addr.region || "").trim();
}

function pickPostcode(addr: Record<string, string | undefined>) {
  return (addr.postcode || "").trim();
}

function pickCountry(addr: Record<string, string | undefined>) {
  return (addr.country || "").trim() || "India";
}

function buildLine1FromNominatim(addr: Record<string, string | undefined>, displayName?: string) {
  const roadLine = [addr.house_number, addr.road].filter(Boolean).join(" ").trim();
  if (roadLine) return roadLine.slice(0, 200);

  const area = [addr.neighbourhood, addr.suburb].filter(Boolean).join(", ").trim();
  if (area) return area.slice(0, 200);

  if (displayName) {
    return displayName.split(",").slice(0, 2).join(",").trim().slice(0, 200);
  }

  return "Pinned location";
}

/** When OSM omits `postcode`, Nominatim `display_name` often still contains a 6-digit Indian PIN. */
function extractPostcodeFromDisplayName(displayName: string | undefined) {
  if (!displayName) return "";
  const m = displayName.match(/\b(\d{6})\b/);
  return m ? m[1] : "";
}

export async function reverseGeocodeNominatim(latitude: number, longitude: number) {
  const userAgent =
    process.env.NOMINATIM_USER_AGENT?.trim() ||
    "PureHarvestsBot/1.0 (+https://example.com)";
  const contact = process.env.NOMINATIM_CONTACT_EMAIL?.trim();

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": contact ? `${userAgent} (${contact})` : userAgent,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn("geocoding.nominatim", "reverse request failed", { status: response.status });
      return null;
    }

    const data = (await response.json()) as NominatimReverseResponse;
    const addr = data.address;
    if (!addr) return null;

    const city = pickCity(addr);
    const state = pickState(addr);
    let postalCode = pickPostcode(addr);
    if (!postalCode) {
      postalCode = extractPostcodeFromDisplayName(data.display_name);
    }
    const country = pickCountry(addr);
    const line1 = buildLine1FromNominatim(addr, data.display_name);

    if (!city) {
      return null;
    }
    if (!postalCode) {
      return null;
    }

    return { line1, city, state, postalCode, country };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.warn("geocoding.nominatim", "reverse geocode error", { message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isValidResolvedPostal(postalCode: string) {
  const v = postalCode.trim();
  if (/^\d{6}$/.test(v)) return true;
  return v.length >= 4 && v.length <= 12;
}

/**
 * Builds a delivery address from a WhatsApp map pin + reverse geocoding.
 * Returns null if coordinates cannot be resolved with enough detail (caller falls back to manual steps).
 */
export async function buildAddressFromPinAndGeocode(pin: LocationPin): Promise<OrderAddressInput | null> {
  const resolved = await reverseGeocodeNominatim(pin.latitude, pin.longitude);
  if (!resolved) return null;

  const primaryFromWhatsApp = pin.address?.trim() || pin.name?.trim();
  const line1 = primaryFromWhatsApp ? primaryFromWhatsApp.slice(0, 200) : resolved.line1;

  const built: OrderAddressInput = {
    line1,
    line2: "",
    geolocation: { latitude: pin.latitude, longitude: pin.longitude },
    city: resolved.city,
    postalCode: resolved.postalCode,
    state: resolved.state,
    country: resolved.country,
  };

  if (built.city.length < 2 || !isValidResolvedPostal(built.postalCode)) {
    return null;
  }

  return built;
}
