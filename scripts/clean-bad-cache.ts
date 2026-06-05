import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Delete cache entries with HTML/XLIFF tags (MyMemory artifacts)
  const htmlTagged = await prisma.translationCache.deleteMany({
    where: { translatedText: { contains: "<" } },
  });

  // Delete potentially wrong-language entries for common words
  const wrongLang = await prisma.translationCache.deleteMany({
    where: {
      targetLang: "hi",
      sourceText: { in: ["Welcome", "Welcome Back"] },
    },
  });

  console.log(`Deleted HTML-tagged cache entries: ${htmlTagged.count}`);
  console.log(`Deleted potentially wrong-language entries: ${wrongLang.count}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
