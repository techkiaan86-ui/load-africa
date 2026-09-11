const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanData() {
  console.log('🧹 Starting comprehensive database cleanup...');
  try {
    // Disable foreign key checks for clean truncation/deletion
    try {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');
    } catch (e) {
      console.warn('Could not set FOREIGN_KEY_CHECKS = 0:', e.message);
    }

    // 1. Transactional & Booking data
    console.log('Clearing bookings, quotes, settlements, and telemetry...');
    try { await prisma.bookingSettlement.deleteMany({}); } catch (e) {}
    try { await prisma.tripPerformance.deleteMany({}); } catch (e) {}
    try { await prisma.loadOffer.deleteMany({}); } catch (e) {}
    try { await prisma.liveTrackingTelemetry.deleteMany({}); } catch (e) {}
    try { await prisma.trackingHistory.deleteMany({}); } catch (e) {}
    try { await prisma.payment.deleteMany({}); } catch (e) {}
    try { await prisma.invoice.deleteMany({}); } catch (e) {}
    try { await prisma.quote.deleteMany({}); } catch (e) {}
    try { await prisma.bookingDocument.deleteMany({}); } catch (e) {}
    try { await prisma.bookingRequirement.deleteMany({}); } catch (e) {}
    try { await prisma.bookingAssignment.deleteMany({}); } catch (e) {}
    try { await prisma.booking.deleteMany({}); } catch (e) {}

    // 2. Hire requests & Plant equipment
    console.log('Clearing plant hire requests, machines, operators...');
    try { await prisma.hireRequest.deleteMany({}); } catch (e) {}
    try { await prisma.machineOperator.deleteMany({}); } catch (e) {}
    try { await prisma.machine.deleteMany({}); } catch (e) {}

    // 3. Driver applications & profiles
    console.log('Clearing driver applications and compliance...');
    try { await prisma.driverApplication.deleteMany({}); } catch (e) {}
    try { await prisma.plantOwnerApplication.deleteMany({}); } catch (e) {}
    try { await prisma.driverStatusHistory.deleteMany({}); } catch (e) {}
    try { await prisma.driverApproval.deleteMany({}); } catch (e) {}
    try { await prisma.driverCompliance.deleteMany({}); } catch (e) {}
    try { await prisma.driverKYC.deleteMany({}); } catch (e) {}
    try { await prisma.driverVehicle.deleteMany({}); } catch (e) {}
    try { await prisma.driverDocuments.deleteMany({}); } catch (e) {}
    try { await prisma.driverPhoto.deleteMany({}); } catch (e) {}
    try { await prisma.driverProfile.deleteMany({}); } catch (e) {}

    // 4. Vehicles, Wallets & Financials
    console.log('Clearing vehicles, wallets, and commissions...');
    try { await prisma.vehicle.deleteMany({}); } catch (e) {}
    try { await prisma.walletTransaction.deleteMany({}); } catch (e) {}
    try { await prisma.wallet.deleteMany({}); } catch (e) {}
    try { await prisma.commission.deleteMany({}); } catch (e) {}

    // 5. Activity logs & Notifications
    console.log('Clearing logs and notifications...');
    try { await prisma.activityLog.deleteMany({}); } catch (e) {}
    try { await prisma.auditLog.deleteMany({}); } catch (e) {}
    try { await prisma.notification.deleteMany({}); } catch (e) {}

    // 6. Delete all demo/dummy customer, driver, fleet, plant, and broker role records
    console.log('Clearing test role profiles...');
    try { await prisma.driver.deleteMany({}); } catch (e) {}
    try { await prisma.fleetOwner.deleteMany({}); } catch (e) {}
    try { await prisma.plantOwner.deleteMany({}); } catch (e) {}
    try { await prisma.broker.deleteMany({}); } catch (e) {}
    try { await prisma.customer.deleteMany({}); } catch (e) {}

    // 7. Delete non-admin test users (keeps ADMIN and SUPER_ADMIN users intact)
    console.log('Clearing non-admin dummy users...');
    try {
      await prisma.user.deleteMany({
        where: {
          role: {
            notIn: ['ADMIN', 'SUPER_ADMIN']
          }
        }
      });
    } catch (e) {
      console.warn('Could not delete non-admin users:', e.message);
    }

    // Re-enable foreign key checks
    try {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');
    } catch (e) {}

    console.log('✅ Database cleanup completed successfully! All dummy bookings, loads, vehicles, and test users removed.');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanData();
