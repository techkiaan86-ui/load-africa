const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fleet1 = await prisma.fleetOwner.findFirst({
    where: { user: { email: 'demofleet@gmail.com' } }
  });

  if (fleet1) {
    const res1 = await prisma.driver.updateMany({
      where: { user: { email: { in: ['deepu@gmail.com', 'sacccc@gmail.com'] } } },
      data: { fleet_owner_id: fleet1.id, status: 'INACTIVE' }
    });

    const res2 = await prisma.user.updateMany({
      where: { email: { in: ['deepu@gmail.com', 'sacccc@gmail.com'] } },
      data: { status: 'PENDING' }
    });

    console.log(`Updated ${res1.count} drivers and ${res2.count} users to PENDING under demofleet.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
