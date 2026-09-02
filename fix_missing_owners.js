const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting DB fix for missing PlantOwner records...');

  const users = await prisma.user.findMany({
    where: { role: 'PLANT_OWNER' },
    include: { plant_owner: true }
  });

  for (const user of users) {
    if (!user.plant_owner) {
      console.log(`User ${user.email} is missing PlantOwner profile. Checking approved applications...`);
      const app = await prisma.plantOwnerApplication.findFirst({
        where: { email: user.email }
      });

      const companyName = app?.company_name || `${user.first_name || 'Plant'} ${user.last_name || 'Owner'}`.trim();
      
      const plantOwner = await prisma.plantOwner.create({
        data: {
          user_id: user.id,
          company_name: companyName,
          status: 'ACTIVE',
          company_documents: app ? {
            registration_document: app.company_reg_doc,
            national_id: app.national_id,
            base_location: app.base_location
          } : undefined
        }
      });

      console.log(`Created PlantOwner profile for ${user.email} (ID: ${plantOwner.id})`);

      if (app) {
        // Also register their machine if not already created
        const existingMachine = await prisma.machine.findFirst({
          where: { registration_number: app.registration_number }
        });

        if (!existingMachine) {
          await prisma.machine.create({
            data: {
              plant_owner_id: plantOwner.id,
              type: app.equipment_type,
              registration_number: app.registration_number,
              status: 'AVAILABLE',
              machine_documents: {
                photo: app.machine_photo,
                make: app.make,
                model: app.model,
                year: app.year
              }
            }
          });
          console.log(`Registered machine ${app.registration_number} for ${user.email}`);
        }
      }
    }
  }
}

main()
  .then(() => console.log('DB fix successfully completed!'))
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
