const { registerUser } = require('./src/services/authService');

const users = [
  { role: 'CUSTOMER', email: 'patrice@arm.co.za', password: 'password123', firstName: 'Patrice', lastName: 'Motsepe' },
  { role: 'DRIVER', email: 'sipho.zuma@load-driver.co.za', password: 'password123', firstName: 'Sipho', lastName: 'Zuma' },
  { role: 'FLEET_OWNER', email: 'fleet@loadafrica.co.za', password: 'password123', firstName: 'Fleet', lastName: 'Owner' },
  { role: 'PLANT_OWNER', email: 'plant@loadafrica.co.za', password: 'password123', firstName: 'Plant', lastName: 'Owner' },
  { role: 'SUPER_ADMIN', email: 'admin@loadafrica.com', password: 'admin123', firstName: 'Admin', lastName: 'User' },
  { role: 'BROKER', email: 'lwazi.dlamini@loadafrica-broker.co.za', password: 'password123', firstName: 'Lwazi', lastName: 'Dlamini' }
];

async function seed() {
  console.log('Starting seed...');
  for (const user of users) {
    try {
      await registerUser(user);
      console.log(`Seeded user: ${user.email} as ${user.role}`);
    } catch (e) {
      console.log(`Failed to seed ${user.email}: ${e.message}`);
    }
  }
  console.log('Seed completed!');
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
