import { connectDB } from "@/lib/db";
import { logger } from "@/lib/utils/logger";
import { OrderModel } from "@/models/Order";
import { ProductModel } from "@/models/Product";

type DeductionLine = { productId: string; quantity: number };

/**
 * When payment is captured, reduce `Product.stock` for each paid line item.
 * Call only on first transition to paid (same moment as `becamePaid` in Razorpay webhook).
 *
 * Uses atomic `stock >= qty` guards; rolls back prior lines if any line fails.
 * Lines without `productId` (legacy orders) are skipped.
 */
export async function applyStockDeductionForPaidOrder(businessOrderId: string): Promise<void> {
  const id = businessOrderId.trim();
  if (!id) return;

  await connectDB();

  const order = await OrderModel.findOne({ businessOrderId: id }).lean();
  if (!order?.items?.length) return;

  const lines: DeductionLine[] = [];
  for (const it of order.items) {
    const pid = typeof it.productId === "string" ? it.productId.trim() : "";
    const qty = typeof it.quantity === "number" ? it.quantity : 0;
    if (pid && qty > 0) {
      lines.push({ productId: pid, quantity: qty });
    }
  }

  if (lines.length === 0) {
    logger.warn("inventory", "order has no productId on lines — stock unchanged", { businessOrderId: id });
    return;
  }

  const applied: DeductionLine[] = [];

  try {
    for (const line of lines) {
      const res = await ProductModel.updateOne(
        { productId: line.productId, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity } },
      );

      if (res.matchedCount === 0) {
        throw new Error(`Insufficient stock for product ${line.productId} (ordered ${line.quantity})`);
      }
      applied.push(line);
    }

    logger.info("inventory", "stock deducted for paid order", {
      businessOrderId: id,
      lines: lines.map((l) => `${l.productId}:-${l.quantity}`).join(", "),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const line of applied.slice().reverse()) {
      await ProductModel.updateOne({ productId: line.productId }, { $inc: { stock: line.quantity } });
    }
    logger.error("inventory", "stock deduction failed — rolled back partial updates", {
      businessOrderId: id,
      error: message,
    });
  }
}
