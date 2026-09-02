const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateETAAndPreparePayment, dispatchLoad, fallbackMatching } = require('./src/services/matchingService');

async function runTest() {
  console.log("=== STARTING VERIFICATION TEST ===");

  try {
    // 1. Create mock users
    const customerUser = await prisma.user.create({ data: { email: `cust_${Date.now()}@test.com`, password: 'pw', role: 'CUSTOMER' } });
    const customer = await prisma.customer.create({ data: { user_id: customerUser.id } });

    const fleetUser = await prisma.user.create({ data: { email: `fleet_${Date.now()}@test.com`, password: 'pw', role: 'FLEET_OWNER', status: 'ACTIVE' } });
    const fleetOwner = await prisma.fleetOwner.create({ data: { user_id: fleetUser.id, status: 'ACTIVE' } });

    const driverUser = await prisma.user.create({ data: { email: `driver_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE' } });
    const driver = await prisma.driver.create({ data: { user_id: driverUser.id, fleet_owner_id: fleetOwner.id, status: 'AVAILABLE' } });

    const driverUser2 = await prisma.user.create({ data: { email: `driver2_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE' } });
    const driver2 = await prisma.driver.create({ data: { user_id: driverUser2.id, fleet_owner_id: fleetOwner.id, status: 'AVAILABLE' } });

    const fleetUser2 = await prisma.user.create({ data: { email: `fleet2_${Date.now()}@test.com`, password: 'pw', role: 'FLEET_OWNER', status: 'ACTIVE' } });
    const fleetOwner2 = await prisma.fleetOwner.create({ data: { user_id: fleetUser2.id, status: 'ACTIVE' } });
    const driverUser3 = await prisma.user.create({ data: { email: `driver3_${Date.now()}@test.com`, password: 'pw', role: 'DRIVER', status: 'ACTIVE' } });
    const driver3 = await prisma.driver.create({ data: { user_id: driverUser3.id, fleet_owner_id: fleetOwner2.id, status: 'AVAILABLE' } });


    // 2. Create vehicles
    const vehicle1 = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner.id, registration_number: `REG_${Date.now()}_1`, vehicle_type: 'TRUCK', capacity: 10000, status: 'ACTIVE' }
    });
    const vehicle2 = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner.id, registration_number: `REG_${Date.now()}_2`, vehicle_type: 'TRUCK', capacity: 10000, status: 'ACTIVE' }
    });
    const vehicle3 = await prisma.vehicle.create({
      data: { fleet_owner_id: fleetOwner2.id, registration_number: `REG_${Date.now()}_3`, vehicle_type: 'TRUCK', capacity: 10000, status: 'ACTIVE' }
    });

    // 3. Update driver profiles with GPS and vehicle association
    await prisma.driver.update({ where: { id: driver.id }, data: { assigned_vehicle_id: vehicle1.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver.id },
      update: { gps_lat: 10.0, gps_lng: 10.0, updated_at: new Date() },
      create: { driver_id: driver.id, gps_lat: 10.0, gps_lng: 10.0 }
    });

    // Driver 2 is further away (10.1, 10.1)
    await prisma.driver.update({ where: { id: driver2.id }, data: { assigned_vehicle_id: vehicle2.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver2.id },
      update: { gps_lat: 10.1, gps_lng: 10.1, updated_at: new Date() },
      create: { driver_id: driver2.id, gps_lat: 10.1, gps_lng: 10.1 }
    });

    // Driver 3 is in fleet 2, furthest (10.5, 10.5)
    await prisma.driver.update({ where: { id: driver3.id }, data: { assigned_vehicle_id: vehicle3.id } });
    await prisma.driverProfile.upsert({
      where: { driver_id: driver3.id },
      update: { gps_lat: 10.5, gps_lng: 10.5, updated_at: new Date() },
      create: { driver_id: driver3.id, gps_lat: 10.5, gps_lng: 10.5 }
    });


    // 4. Create booking
    const booking = await prisma.booking.create({
      data: {
        customer_id: customer.id,
        weight: 5000,
        cargo_category: 'GENERAL',
        cargo_name: 'Test Cargo',
        delivery_address: 'Dest',
        delivery_date: new Date(),
        pickup_address: 'Start',
        pickup_date: new Date(),
        pickup_coords_lat: 10.001, // Very close to Driver 1
        pickup_coords_lng: 10.001,
        status: 'ETA_CALCULATION'
      }
    });

    // Add a dummy quote so invoice can be generated
    await prisma.quote.create({
      data: {
        booking_id: booking.id,
        grand_total: 1500,
        status: 'ACCEPTED'
      }
    });

    console.log(`Booking Created: ${booking.id}`);

    // TEST 1: Calculate ETA and Prepare Payment
    console.log("\n--- TEST 1: calculateETAAndPreparePayment ---");
    const result1 = await calculateETAAndPreparePayment(booking.id);
    console.log("Result:", result1);

    let updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: { invoices: true } });
    console.log(`Status: ${updatedBooking.status} (Expected: PAYMENT_PENDING)`);
    console.log(`ETA: ${updatedBooking.estimated_pickup_time}`);
    console.log(`Invoices Created: ${updatedBooking.invoices.length}`);

    let heldOffer = await prisma.loadOffer.findFirst({ where: { booking_id: booking.id, status: 'HELD_PENDING_PAYMENT' } });
    console.log(`HELD Offer for Fleet: ${heldOffer?.fleet_owner_id} (Expected: ${fleetOwner.id})`);
    console.log(`Reference Driver: ${heldOffer?.driver_id} (Expected: ${driver.id})`);

    // TEST 2: Dispatch Load (Mock Payment Success)
    console.log("\n--- TEST 2: dispatchLoad ---");
    await dispatchLoad(booking.id);
    updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    console.log(`Status: ${updatedBooking.status} (Expected: TRANSPORTER_ASSIGNMENT)`);
    
    let activeOffer = await prisma.loadOffer.findFirst({ where: { id: heldOffer.id } });
    console.log(`Offer Status: ${activeOffer.status} (Expected: PENDING)`);

    // TEST 3: Fleet Owner Receives Assignment and select Driver 1 (Handled by fleetController in reality, but we'll simulate Driver rejection)
    console.log("\n--- TEST 3: fallbackMatching (Driver 1 Rejects) ---");
    // Simulate Driver 1 rejecting
    await prisma.loadOffer.update({ where: { id: activeOffer.id }, data: { status: 'REJECTED' } });
    await fallbackMatching(booking.id, driver.id);

    updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    console.log(`Status after fallback: ${updatedBooking.status} (Expected: TRANSPORTER_ASSIGNMENT)`);
    
    let newOffer = await prisma.loadOffer.findFirst({ where: { booking_id: booking.id, status: 'PENDING' } });
    console.log(`New PENDING Offer Fleet: ${newOffer?.fleet_owner_id}`);
    console.log(`New PENDING Reference Driver: ${newOffer?.driver_id} (Expected: ${driver2.id})`);

    console.log("\n=== TEST COMPLETED SUCCESSFULLY ===");

  } catch (error) {
    console.error("TEST FAILED:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
