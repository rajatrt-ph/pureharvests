/**
 * One-time: maps legacy orderStatus `ready_to_ship` → `shipped` after removing that stage from the app.
 * Run: node --env-file=.env.local scripts/migrate-order-status-remove-ready-to-ship.mjs
 */
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI");
}

async function main() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  const col = mongoose.connection.collection("orders");
  const result = await col.updateMany({ orderStatus: "ready_to_ship" }, { $set: { orderStatus: "shipped" } });
  console.log(`Updated ${result.modifiedCount} orders (matched ${result.matchedCount}).`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
