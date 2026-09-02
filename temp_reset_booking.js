const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function reset() {
  const bookingId = '75620bbb-6146-4ad0-b529-1b882328dcb1';
  
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'QUOTE_PREPARED' }
  });
  console.log('Booking reset to QUOTE_PREPARED');
}

reset().finally(() => prisma.$disconnect());
