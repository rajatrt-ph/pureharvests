import mongoose, { type InferSchemaType } from "mongoose";

const SessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    currentFlow: {
      type: String,
      enum: ["order", "track"],
      default: null,
    },
    step: { type: String, trim: true, default: "" },
    cartId: { type: String, trim: true, default: "" },
    tempData: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type Session = InferSchemaType<typeof SessionSchema>;

export const SessionModel =
  (mongoose.models.Session as mongoose.Model<Session>) ||
  mongoose.model<Session>("Session", SessionSchema);

