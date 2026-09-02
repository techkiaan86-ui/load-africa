const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { name: 'Bakkie / Light Duty', description: 'Single cab / Double cab bakkie for small moves and light cargo', base_price_per_km: 12.00, capacity_tons: 1.0, is_active: true },
  { name: '4-Ton Truck', description: 'Medium closed box or flatbed truck suitable for furniture & general goods', base_price_per_km: 18.00, capacity_tons: 4.0, is_active: true },
  { name: '8-Ton Truck', description: 'Heavy duty curtain-side or flatbed truck for medium-to-large freight', base_price_per_km: 25.00, capacity_tons: 8.0, is_active: true },
  { name: '14-Ton Truck', description: 'Large multi-axle freight truck for heavy industrial loads', base_price_per_km: 30.00, capacity_tons: 14.0, is_active: true },
  { name: '34-Ton Tri-Axle', description: 'Super heavy interlink tri-axle truck for bulk transport', base_price_per_km: 38.00, capacity_tons: 34.0, is_active: true },
  { name: 'Refrigerated Truck', description: 'Temperature-controlled cold room truck for perishables & pharmaceuticals', base_price_per_km: 28.00, capacity_tons: 8.0, is_active: true },
];

const seedVehicleCategories = async () => {
  try {
    for (const cat of DEFAULT_CATEGORIES) {
      await prisma.vehicleCategory.upsert({
        where: { name: cat.name },
        update: {
          description: cat.description,
          base_price_per_km: cat.base_price_per_km,
          capacity_tons: cat.capacity_tons,
          is_active: cat.is_active,
          is_deleted: false,
        },
        create: {
          name: cat.name,
          description: cat.description,
          base_price_per_km: cat.base_price_per_km,
          capacity_tons: cat.capacity_tons,
          is_active: cat.is_active,
        },
      });
    }
    console.log('✅ Vehicle Categories seeded/updated successfully.');
  } catch (error) {
    console.error('Error seeding vehicle categories:', error.message);
  }
};

module.exports = seedVehicleCategories;

if (require.main === module) {
  seedVehicleCategories().then(() => prisma.$disconnect());
}
