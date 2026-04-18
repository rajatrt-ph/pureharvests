import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Add it to .env.local first.");
}

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
const PAYMENT_STATUSES = ["pending", "paid", "failed"];

const FIRST_NAMES = [
  "Aarav",
  "Ishaan",
  "Meera",
  "Anaya",
  "Kabir",
  "Riya",
  "Neha",
  "Arjun",
  "Saanvi",
  "Vikram",
  "Diya",
  "Rahul",
];

const LAST_NAMES = [
  "Sharma",
  "Patel",
  "Gupta",
  "Nair",
  "Reddy",
  "Kapoor",
  "Iyer",
  "Singh",
  "Joshi",
  "Khan",
];

const STREETS = [
  "Green Valley Road",
  "Mango Orchard Lane",
  "Coconut Grove Street",
  "Riverbank Avenue",
  "Hillview Colony",
  "Sunrise Enclave",
  "Lakefront Block",
  "Jasmine Park",
];

const PRODUCTS = [
  "Organic Tomatoes",
  "Cold-Pressed Mustard Oil",
  "Farm Fresh Spinach",
  "Natural Honey",
  "Whole Wheat Flour",
  "Organic Turmeric Powder",
  "Fresh Cow Ghee",
  "Raw Jaggery",
  "Green Moong Dal",
  "A2 Paneer",
];

const OrderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    address: { type: String, required: true },
    items: [
      {
        productName: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
      },
    ],
    orderValue: { type: Number, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    orderStatus: { type: String, enum: ORDER_STATUSES, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true, collection: "orders" },
);

const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildPhone() {
  return `9${randomInt(100000000, 999999999)}`;
}

function buildAddress() {
  return `${randomInt(11, 248)}, ${pick(STREETS)}, Bengaluru`;
}

function buildItems() {
  const count = randomInt(1, 4);
  const items = [];
  const used = new Set();

  while (items.length < count) {
    const productName = pick(PRODUCTS);
    if (used.has(productName)) continue;
    used.add(productName);

    const quantity = randomInt(1, 5);
    const price = randomInt(80, 650);
    items.push({ productName, quantity, price });
  }

  return items;
}

function totalValue(items) {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function buildOrder() {
  const customerName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const items = buildItems();
  const orderStatus = pick(ORDER_STATUSES);
  const paymentStatus =
    orderStatus === "delivered"
      ? pick(["paid", "paid", "pending"])
      : orderStatus === "cancelled"
        ? pick(["failed", "pending"])
        : pick(PAYMENT_STATUSES);

  const notes =
    orderStatus === "cancelled"
      ? "Customer requested cancellation."
      : orderStatus === "delivered"
        ? "Delivered successfully."
        : "";

  const daysAgo = randomInt(0, 20);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  return {
    customerName,
    phoneNumber: buildPhone(),
    address: buildAddress(),
    items,
    orderValue: totalValue(items),
    paymentStatus,
    orderStatus,
    notes,
    createdAt,
    updatedAt: createdAt,
  };
}

async function main() {
  const requested = Number.parseInt(process.argv[2] ?? "", 10);
  const count =
    Number.isFinite(requested) && requested >= 10 && requested <= 20
      ? requested
      : randomInt(10, 20);

  await mongoose.connect(MONGODB_URI, { bufferCommands: false });

  const docs = Array.from({ length: count }, () => buildOrder());
  const inserted = await Order.insertMany(docs);

  console.log(`Inserted ${inserted.length} orders.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed to seed orders:", error);
  await mongoose.disconnect();
  process.exit(1);
});

