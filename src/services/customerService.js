const { prisma } = require('../config/db');

const getCustomerDashboard = async (userId) => {
  const customer = await prisma.customer.findUnique({
    where: { user_id: userId },
    include: {
      user: {
        include: {
          wallets: true
        }
      }
    }
  });

  if (!customer) {
    throw new Error('Customer profile not found');
  }

  // Get active bookings count
  const activeBookingsCount = await prisma.booking.count({
    where: {
      customer_id: customer.id,
      status: { in: ['DRIVER_ASSIGNED', 'PICKUP_SCHEDULED', 'PICKUP_ARRIVED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] }
    }
  });

  // Count bookings where broker has prepared a quote — customer needs to act
  const pendingQuotesCount = await prisma.booking.count({
    where: {
      customer_id: customer.id,
      status: 'QUOTE_PREPARED',
    }
  });

  // Get total bookings
  const totalBookings = await prisma.booking.count({
    where: { customer_id: customer.id }
  });

  // Fetch recent bookings with quotes for pricing display
  const recentBookings = await prisma.booking.findMany({
    where: { customer_id: customer.id },
    orderBy: { created_at: 'desc' },
    take: 5,
    include: {
      quotes: { orderBy: { created_at: 'desc' }, take: 1 },
      assignments: {
        where: { status: 'ACTIVE' },
        include: { driver: { include: { user: true } } },
        take: 1
      }
    }
  });

  const walletBalance = customer.user.wallets[0]?.balance || 0;

  return {
    activeBookingsCount,
    pendingQuotesCount,
    totalBookings,
    walletBalance,
    recentBookings
  };
};



/**
 * Returns all bookings where the Broker has prepared an official quotation.
 * These are the bookings where the customer must Accept or Reject the quote.
 */
const getMyQuotations = async (userId) => {
  const customer = await prisma.customer.findUnique({
    where: { user_id: userId },
  });

  if (!customer) {
    throw new Error('Customer profile not found');
  }

  const quotations = await prisma.booking.findMany({
    where: {
      customer_id: customer.id,
      status: { in: ['QUOTE_REQUESTED', 'QUOTE_PREPARED', 'CUSTOMER_ACCEPTED', 'BOOKING_CONFIRMED', 'REJECTED'] },
      is_deleted: false,
    },
    orderBy: { updated_at: 'desc' },
    include: {
      quotes: {
        orderBy: { created_at: 'desc' },
        take: 1,
      },
      requirements: true,
    },
  });

  return quotations;
};

module.exports = { getCustomerDashboard, getMyQuotations };

