const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN notification_preferences LONGTEXT;`);
    console.log('Column added successfully');
  } catch (error) {
    if (error.message.includes('Duplicate column name')) {
      console.log('Column already exists');
    } else {
      console.error('Error:', error);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
