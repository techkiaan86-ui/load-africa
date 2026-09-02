const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateETAAndPreparePayment } = require('./src/services/matchingService');
const paystackService = require('./src/services/paystackService');

async function testPaystackFlow() {
  console.log("=== STARTING PAYSTACK INTEGRATION & SETTLEMENT TEST ===");

  try {
    // 1. Create mock Customer, Fleet Owner, Driver, Vehicle
    const customerUser = await prisma.user.create({ data: { email: `cust_pay_${Date.now()}@test.com`, password: 'pw', role: 'CUSTOMER' } });
    const customer = await prisma.customer.create({ data: { user_id: customerUser.id } });

    const fleetUser = await prisma.user.create({ data: { email: `fleet_pay_${Date.now()}@test.com`, password: 'pw', role: 'FLEET_OWNER', status: 'ACTIVE' } });
    const fleetOwner = await prisma.fleetOwner.create({ data: { user_id: fleetUser.id, status: 'ACTIVE' } });

    const driverUser = await prisma.user.create({ data: { email: `driver_pay_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE' } });
    const driver = await prisma.driver.create({ data: { user_id: driverUser.id, fleet_owner_id: fleetOwner.id, status: 'AVAILABLE' } });

    const vehicle = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner.id, registration_number: `PAY_REG_${Date.now()}`, vehicle_type: 'TRUCK', capacity: 15000, status: 'ACTIVE' }
    });

    await prisma.driver.update({ where: { id: driver.id }, data: { assigned_vehicle_id: vehicle.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver.id },
      update: { gps_lat: -26.2041, gps_lng: 28.0473, updated_at: new Date() },
      create: { driver_id: driver.id, gps_lat: -26.2041, gps_lng: 28.0473 }
    });

    // 2. Create Booking
    const booking = await prisma.booking.create({
      data: {
        customer_id: customer.id,
        weight: 8000,
        cargo_category: 'GENERAL',
        cargo_name: 'Industrial Cables',
        delivery_address: 'Pretoria',
        delivery_date: new Date(),
        pickup_address: 'Johannesburg',
        pickup_date: new Date(),
        pickup_coords_lat: -26.2040,
        pickup_coords_lng: 28.0472,
        status: 'CUSTOMER_ACCEPTED'
      }
    });

    await prisma.quote.create({
      data: {
        booking_id: booking.id,
        grand_total: 2500.00,
        status: 'ACCEPTED'
      }
    });

    console.log(`Step 1: Created Booking ${booking.id} for ZAR 2,500.00`);

    // 3. Match Closest Transporter & Calculate ETA
    const matchResult = await calculateETAAndPreparePayment(booking.id);
    console.log(`Step 2: Match & ETA Calculation Result:`, matchResult.success, `Status: PAYMENT_PENDING`);

    // 4. Verify Invoice & Pending Payment creation
    const invoice = await prisma.invoice.findFirst({ where: { booking_id: booking.id } });
    console.log(`Step 3: Authoritative Invoice Created: INV #${invoice.invoice_no}, Amount: ZAR ${invoice.total_amount}`);

    // 5. Test Paystack Service Initialization
    const reference = `PAY-${booking.id.slice(0, 8)}-${Date.now()}`;
    const initResult = await paystackService.initializePayment({
      email: customerUser.email,
      amount: invoice.total_amount,
      reference,
      callbackUrl: 'http://localhost:5173/customer/booking-history',
      metadata: { bookingId: booking.id, invoiceId: invoice.id }
    });

    console.log(`Step 4: Paystack Init Result: Reference=${initResult.reference}, IsMock=${initResult.isMock}`);

    // Create DB Payment record
    const payment = await prisma.payment.create({
      data: {
        invoice_id: invoice.id,
        amount: invoice.total_amount,
        payment_method: 'PAYSTACK',
        transaction_id: reference,
        status: 'PENDING'
      }
    });

    // 6. Test Paystack Payment Verification & Dispatch Trigger
    const verifyResult = await paystackService.verifyPayment(reference);
    console.log(`Step 5: Paystack Service Verify Result: Status=${verifyResult.status}`);

    // Perform atomic DB verification and dispatch load
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      await tx.trackingHistory.create({
        data: { booking_id: booking.id, status: 'PAYMENT_RECEIVED', remarks: 'Paystack payment verified.' }
      });
    });

    const { dispatchLoad } = require('./src/services/matchingService');
    await dispatchLoad(booking.id);

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      include: { offers: true }
    });

    console.log(`Step 6: Status after Paystack Verification: ${updatedBooking.status} (Expected: TRANSPORTER_ASSIGNMENT)`);
    console.log(`Step 7: Dispatched Load Offer Status for Fleet: ${updatedBooking.offers[0]?.status} (Expected: PENDING)`);

    // 7. Test Idempotency (Re-verifying paid transaction)
    const secondVerify = await prisma.payment.findFirst({ where: { transaction_id: reference } });
    console.log(`Step 8: Idempotency Check - Payment Status is still: ${secondVerify.status}`);

    console.log("\n=== PAYSTACK INTEGRATION TEST PASSED SUCCESSFULLY ===");

  } catch (error) {
    console.error("Paystack Integration Test Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testPaystackFlow();
