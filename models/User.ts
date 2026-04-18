import mongoose, { type InferSchemaType } from "mongoose";

const GeolocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false },
);

const AddressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "" },
    line1: { type: String, trim: true, required: true },
    line2: { type: String, trim: true, default: "" },
    /** Map pin coordinates when the user shared location (not stored in line2). */
    geolocation: { type: GeolocationSchema, required: false, default: undefined },
    city: { type: String, trim: true, required: true },
    state: { type: String, trim: true, default: "" },
    postalCode: { type: String, trim: true, required: true },
    country: { type: String, trim: true, default: "India" },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, default: () => crypto.randomUUID() },
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    addresses: { type: [AddressSchema], default: [] },
    status: { type: String, enum: ["active", "pending"], default: "pending", required: true },
  },
  { timestamps: true },
);

export type User = InferSchemaType<typeof UserSchema>;

export const UserModel =
  (mongoose.models.User as mongoose.Model<User>) || mongoose.model<User>("User", UserSchema);

