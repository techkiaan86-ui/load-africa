const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanData() {
  console.log('Starting database cleanup (keeping Users, Roles and System Configs)...');
  try {
    // 1. Delete plant hire requests and machines (which reference booking/operator)
    await prisma.hireRequest.deleteMany({});
    await prisma.machine.deleteMany({});
    await prisma.machineOperator.deleteMany({});

    // 2. Delete transactional / booking details
    await prisma.payment.deleteMany({});
    await prisma.invoice.deleteMany({});
    await prisma.bookingAssignment.deleteMany({});
    await prisma.commission.deleteMany({});
    await prisma.quote.deleteMany({});
    await prisma.bookingRequirement.deleteMany({});
    await prisma.bookingDocument.deleteMany({});
    await prisma.trackingHistory.deleteMany({});
    await prisma.liveTrackingTelemetry.deleteMany({});
    await prisma.booking.deleteMany({});
    
    // 3. Delete logs and notifications
    await prisma.activityLog.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.notification.deleteMany({});
    
    // 4. Delete applications & history
    await prisma.driverApplication.deleteMany({});
    await prisma.plantOwnerApplication.deleteMany({});
    await prisma.driverStatusHistory.deleteMany({});
    await prisma.driverApproval.deleteMany({});
    
    // 5. Delete wallet transactions
    await prisma.walletTransaction.deleteMany({});
    await prisma.wallet.deleteMany({});
    
    console.log('✅ Database cleanup completed successfully! (User logins remain intact)');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanData();
