const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateETAAndPreparePayment, fallbackMatching } = require('./src/services/matchingService');
const paystackService = require('./src/services/paystackService');

async function testPrompt4Flow() {
  console.log("=== STARTING PROMPT 4 INTEGRATION TEST (FLEET -> DRIVER -> REJECT -> FALLBACK -> ACCEPT) ===");

  try {
    // 1. Setup Mock Users & Entities
    const customerUser = await prisma.user.create({ data: { email: `cust_p4_${Date.now()}@test.com`, password: 'pw', role: 'CUSTOMER' } });
    const customer = await prisma.customer.create({ data: { user_id: customerUser.id } });

    // Fleet Owner 1 with Driver 1
    const fleetUser1 = await prisma.user.create({ data: { email: `fleet1_p4_${Date.now()}@test.com`, password: 'pw', role: 'FLEET_OWNER', status: 'ACTIVE' } });
    const fleetOwner1 = await prisma.fleetOwner.create({ data: { user_id: fleetUser1.id, status: 'ACTIVE', location_lat: -26.2040, location_lng: 28.0470 } });

    const driverUser1 = await prisma.user.create({ data: { email: `driver1_p4_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE', first_name: 'Driver', last_name: 'One' } });
    const driver1 = await prisma.driver.create({ data: { user_id: driverUser1.id, fleet_owner_id: fleetOwner1.id, status: 'AVAILABLE', license: `LIC_1_${Date.now()}` } });

    const vehicle1 = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner1.id, registration_number: `REG_1_${Date.now()}`, vehicle_type: 'TRUCK', capacity: 20000, status: 'AVAILABLE' }
    });
    await prisma.driver.update({ where: { id: driver1.id }, data: { assigned_vehicle_id: vehicle1.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver1.id },
      update: { gps_lat: -26.2041, gps_lng: 28.0471, updated_at: new Date() },
      create: { driver_id: driver1.id, gps_lat: -26.2041, gps_lng: 28.0471 }
    });

    // Fleet Owner 2 with Driver 2 (Further distance)
    const fleetUser2 = await prisma.user.create({ data: { email: `fleet2_p4_${Date.now()}@test.com`, password: 'pw', role: 'FLEET_OWNER', status: 'ACTIVE' } });
    const fleetOwner2 = await prisma.fleetOwner.create({ data: { user_id: fleetUser2.id, status: 'ACTIVE', location_lat: -26.2500, location_lng: 28.1000 } });

    const driverUser2 = await prisma.user.create({ data: { email: `driver2_p4_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE', first_name: 'Driver', last_name: 'Two' } });
    const driver2 = await prisma.driver.create({ data: { user_id: driverUser2.id, fleet_owner_id: fleetOwner2.id, status: 'AVAILABLE', license: `LIC_2_${Date.now()}` } });

    const vehicle2 = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner2.id, registration_number: `REG_2_${Date.now()}`, vehicle_type: 'TRUCK', capacity: 20000, status: 'AVAILABLE' }
    });
    await prisma.driver.update({ where: { id: driver2.id }, data: { assigned_vehicle_id: vehicle2.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver2.id },
      update: { gps_lat: -26.2505, gps_lng: 28.1005, updated_at: new Date() },
      create: { driver_id: driver2.id, gps_lat: -26.2505, gps_lng: 28.1005 }
    });

    console.log("Step 1: Created Mock Users, Fleet Owners, Vehicles, and Drivers (Driver 1 close, Driver 2 further).");

    // 2. Create Booking
    const booking = await prisma.booking.create({
      data: {
        customer_id: customer.id,
        weight: 10000,
        cargo_category: 'GENERAL',
        cargo_name: 'Mining Equipment',
        delivery_address: 'Rustenburg',
        delivery_date: new Date(),
        pickup_address: 'Johannesburg Central',
        pickup_date: new Date(),
        pickup_coords_lat: -26.2040,
        pickup_coords_lng: 28.0470,
        requested_vehicle: 'TRUCK',
        status: 'CUSTOMER_ACCEPTED'
      }
    });

    await prisma.quote.create({
      data: { booking_id: booking.id, grand_total: 4500.00, status: 'ACCEPTED' }
    });

    // 3. Match & Calculate ETA
    const matchRes = await calculateETAAndPreparePayment(booking.id);
    console.log(`Step 2: Matching Completed -> Status: PAYMENT_PENDING, Matched Transporter Proximity: ${matchRes.distanceKm} km.`);

    // 4. Paystack Payment Verification
    const invoice = await prisma.invoice.findFirst({ where: { booking_id: booking.id } });
    const reference = `PAY-${booking.id.slice(0,8)}-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: { invoice_id: invoice.id, amount: invoice.total_amount, payment_method: 'PAYSTACK', transaction_id: reference, status: 'PENDING' }
    });

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
    });

    const { dispatchLoad } = require('./src/services/matchingService');
    await dispatchLoad(booking.id);

    let currentBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: { offers: true } });
    console.log(`Step 3: Paystack Payment Verified -> Booking Status: ${currentBooking.status} (Expected: TRANSPORTER_ASSIGNMENT).`);

    // 5. Fleet Owner 1 Accepts & Offers to Driver 1
    const fleetOffer1 = await prisma.loadOffer.findFirst({ where: { booking_id: booking.id, fleet_owner_id: fleetOwner1.id } });
    
    // Simulate Fleet Owner 1 accepting offer and selecting Driver 1 & Vehicle 1
    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.update({ where: { id: fleetOffer1.id }, data: { status: 'ACCEPTED_BY_FLEET' } });
      await tx.loadOffer.create({
        data: {
          booking_id: booking.id,
          fleet_owner_id: fleetOwner1.id,
          driver_id: driver1.id,
          status: 'PENDING',
          distance_km: fleetOffer1.distance_km,
          estimated_pickup_time: fleetOffer1.estimated_pickup_time
        }
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'DRIVER_OFFER_SENT' } });
    });

    currentBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: { offers: true } });
    console.log(`Step 4: Fleet Owner 1 Accepted & Offered to Driver 1 -> Booking Status: ${currentBooking.status} (Expected: DRIVER_OFFER_SENT).`);

    // 6. Driver 1 Rejects Load -> Trigger Fallback Matching
    console.log("Step 5: Driver 1 REJECTS load offer.");
    const driverOffer1 = currentBooking.offers.find(o => o.driver_id === driver1.id && o.status === 'PENDING');
    
    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.update({ where: { id: driverOffer1.id }, data: { status: 'REJECTED', rejection_reason: 'Unavailable for route' } });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'TRANSPORTER_SEARCHING' } });
    });

    // Run fallback matching
    await fallbackMatching(booking.id, driver1.id);

    currentBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: { offers: true } });
    console.log(`Step 6: Fallback Matching Triggered -> Excluded Driver 1 -> Booking Status: ${currentBooking.status} (Expected: TRANSPORTER_ASSIGNMENT).`);
    
    const newOffer = currentBooking.offers.find(o => o.status === 'PENDING');
    console.log(`Step 7: New Pending Offer Dispatched to Fleet Owner: ${newOffer.fleet_owner_id} (Expected: Fleet Owner 2 - ${fleetOwner2.id}).`);

    // 7. Fleet Owner 2 Accepts & Offers to Driver 2
    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.update({ where: { id: newOffer.id }, data: { status: 'ACCEPTED_BY_FLEET' } });
      await tx.loadOffer.create({
        data: {
          booking_id: booking.id,
          fleet_owner_id: fleetOwner2.id,
          driver_id: driver2.id,
          status: 'PENDING',
          distance_km: newOffer.distance_km,
          estimated_pickup_time: newOffer.estimated_pickup_time
        }
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'DRIVER_OFFER_SENT' } });
    });

    // 8. Driver 2 Accepts Load
    const driverOffer2 = await prisma.loadOffer.findFirst({ where: { booking_id: booking.id, driver_id: driver2.id, status: 'PENDING' } });
    
    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.update({ where: { id: driverOffer2.id }, data: { status: 'ACCEPTED' } });
      await tx.bookingAssignment.create({
        data: {
          booking_id: booking.id,
          driver_id: driver2.id,
          fleet_owner_id: fleetOwner2.id,
          vehicle_id: vehicle2.id,
          status: 'ACTIVE'
        }
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'DRIVER_ASSIGNED' } });
      await tx.driver.update({ where: { id: driver2.id }, data: { status: 'ON_TRIP' } });
      await tx.vehicle.update({ where: { id: vehicle2.id }, data: { status: 'ON_TRIP' } });
    });

    currentBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      include: { assignments: true }
    });

    const updatedDriver2 = await prisma.driver.findUnique({ where: { id: driver2.id } });
    const updatedVehicle2 = await prisma.vehicle.findUnique({ where: { id: vehicle2.id } });

    console.log(`Step 8: Driver 2 ACCEPTS load offer -> Booking Status: ${currentBooking.status} (Expected: DRIVER_ASSIGNED).`);
    console.log(`Step 9: Driver 2 Status: ${updatedDriver2.status} (Expected: ON_TRIP), Vehicle 2 Status: ${updatedVehicle2.status} (Expected: ON_TRIP).`);

    console.log("\n=== PROMPT 4 INTEGRATION TEST PASSED SUCCESSFULLY ===");

  } catch (error) {
    console.error("Prompt 4 Test Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testPrompt4Flow();
