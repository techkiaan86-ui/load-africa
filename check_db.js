const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const user = await prisma.user.findUnique({ where: { email: 'plant@loadafrica.co.za' } });
  if (user) {
    const owner = await prisma.plantOwner.findUnique({ where: { user_id: user.id } });
    console.log('Owner ID for this email:', owner ? owner.id : 'No plant owner profile');
    
    if (owner) {
        await prisma.hireRequest.updateMany({
            data: { plant_owner_id: owner.id }
        });
        console.log('Updated all hire requests to belong to THIS owner!');
    }
  } else {
    console.log('User not found');
  }
}
check().catch(console.error).finally(() => prisma.$disconnect());
