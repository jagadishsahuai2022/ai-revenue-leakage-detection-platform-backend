import { PrismaClient } from "@prisma/client";

(async () => {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst();
  console.log("user", user);
  await prisma.$disconnect();
})();
