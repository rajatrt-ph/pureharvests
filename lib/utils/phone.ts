export function normalizePhone(phone: string) {
  return phone.trim().replace(/[^\d]/g, "");
}

export function isValidPhone(phone: string) {
  const normalized = normalizePhone(phone);
  return /^\d{10,15}$/.test(normalized);
}

