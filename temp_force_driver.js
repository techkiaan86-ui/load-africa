const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function force() {
  const driverId = '81d2041b-57b4-452f-9547-5e36409aa71a'; // kiaan2a

  await prisma.driver.update({
    where: { id: driverId },
    data: { status: 'AVAILABLE' }
  });

  const dp = await prisma.driverProfile.upsert({
    where: { driver_id: driverId },
    update: {
      gps_lat: 22.6846,
      gps_lng: 75.8640,
      updated_at: new Date()
    },
    create: {
      driver_id: driverId,
      gps_lat: 22.6846,
      gps_lng: 75.8640,
      updated_at: new Date()
    }
  });

  console.log('Forced driver to available with recent GPS', dp);
}

force().finally(() => prisma.$disconnect());
