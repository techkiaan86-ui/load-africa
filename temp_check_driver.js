const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const drivers = await prisma.driver.findMany({
    include: { user: true, documents_relation: true }
  });
  console.log(JSON.stringify(drivers.map(d => ({
    id: d.id,
    name: d.user?.first_name,
    fleet_owner_id: d.fleet_owner_id,
    status: d.status,
    docs: d.documents_relation
  })), null, 2));
}

check().finally(() => prisma.$disconnect());
