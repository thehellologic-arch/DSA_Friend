import { MongoClient, type Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB?.trim() || "reason");
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
