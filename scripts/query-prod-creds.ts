import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

async function main() {
  const url = process.env.PROD_DATABASE_URL;
  console.log("Connecting to", url?.slice(0, 40) + "...");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const creds = await prisma.testCredential.findMany();
    console.log("Test credentials count:", creds.length);
    creds.forEach((c) => {
      console.log(
        "providerId=",
        c.providerId,
        "credentials=",
        JSON.stringify(c.credentials),
      );
    });
  } catch (e) {
    console.error("Error querying:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
