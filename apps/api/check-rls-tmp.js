const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  await prisma.$executeRawUnsafe("RESET app.current_tenant");
  const setting = await prisma.$queryRawUnsafe("SELECT current_setting('app.current_tenant', true) AS tenant");
  const rows = await prisma.$queryRawUnsafe("SELECT id FROM organizations LIMIT 5");
  console.log("tenant setting after reset:", setting);
  console.log("rows:", rows);
  await prisma.$disconnect();
})();
