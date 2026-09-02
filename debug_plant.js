const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Check applications
  const apps = await p.plantOwnerApplication.findMany({
    select: { id: true, email: true, company_name: true, status: true, equipment_type: true, registration_number: true }
  });
  console.log('Applications:', JSON.stringify(apps, null, 2));
  
  // Check PlantOwner records again
  const owners = await p.plantOwner.findMany({
    include: { machines: { select: { id: true, type: true, registration_number: true } } }
  });
  console.log('PlantOwners with machines:', JSON.stringify(owners, null, 2));

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
