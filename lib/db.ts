import mongoose from "mongoose";

type MongooseCache = {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

const globalCache =
  globalThis.mongoose ??
  (globalThis.mongoose = {
    conn: null,
    promise: null,
  });

export async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("Missing environment variable: MONGODB_URI");
  }

  if (globalCache.conn && globalCache.conn.readyState === 1) {
    return globalCache.conn;
  }

  if (!globalCache.promise) {
    globalCache.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
      })
      .then((m) => m.connection)
      .catch((error: unknown) => {
        globalCache.promise = null;
        const message = error instanceof Error ? error.message : "Unknown MongoDB error";
        throw new Error(`Failed to connect to MongoDB: ${message}`);
      });
  }

  globalCache.conn = await globalCache.promise;
  return globalCache.conn;
}

// Backward-compatible alias for existing imports in this codebase.
export const connectToDatabase = connectDB;

