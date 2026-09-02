const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const profiles = await prisma.driverProfile.findMany();
  console.log('DriverProfiles:', profiles);

  const fleets = await prisma.fleetOwner.findMany({
    select: { id: true, location_lat: true, location_lng: true, status: true }
  });
  console.log('Fleets:', fleets);
}

check().finally(() => prisma.$disconnect());
