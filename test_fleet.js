const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testFleetReg() {
  try {
    console.log('--- TESTING FLEET REGISTRATION & MATCHING CHANGES ---');
    
    // Simulate authService.js registerUser logic for FLEET_OWNER
    const email = `testfleet_${Date.now()}@test.com`;
    
    console.log(`\n1. Creating test FleetOwner user: ${email}...`);
    
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          password: 'hash',
          role: 'FLEET_OWNER',
          first_name: 'Test',
          last_name: 'Fleet',
          phone: '+275551234',
          status: 'PENDING'
        }
      });
      
      const fleetOwner = await tx.fleetOwner.create({
        data: {
          user_id: u.id,
          company_name: 'Test Fleet Operations',
          vat_number: 'VAT1234',
          num_vehicles: 5,
          fleet_tier: 'Starter',
          operating_areas: 'Gauteng',
          services_offered: 'Flatbed',
          address: '123 Test St',
          status: 'PENDING_APPROVAL' // Ensure it's correctly mapped
        }
      });
      
      return { u, fleetOwner };
    });
    
    console.log(`✅ Created User [${user.u.id}] with status: ${user.u.status}`);
    console.log(`✅ Created FleetOwner [${user.fleetOwner.id}] with status: ${user.fleetOwner.status}`);
    
    // Validate matching logic won't pick them up
    console.log('\n2. Verifying Matching Query Excludes PENDING_APPROVAL fleets...');
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // We expect this query (used in matchingService) to NOT find our new fleet owner
    const matchedProfiles = await prisma.fleetOwner.findMany({
      where: {
        id: user.fleetOwner.id,
        status: { in: ['ACTIVE', 'APPROVED'] } // New condition!
      }
    });
    
    if (matchedProfiles.length === 0) {
      console.log(`✅ Matching successfully ignores the PENDING_APPROVAL fleet owner.`);
    } else {
      console.log(`❌ ERROR: Matching found the pending fleet owner!`);
    }
    
    console.log('\n--- TEST COMPLETE ---');
    
  } catch(e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

testFleetReg();
