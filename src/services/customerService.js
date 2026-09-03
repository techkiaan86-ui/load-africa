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
      status: { in: ['DRIVER_ASSIGNED', 'PICKUP_SCHEDULED', 'PICKUP_ARRIVED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'TRANSPORTER_SEARCHING', 'OFFER_SENT', 'AVAILABILITY_CONFIRMED', 'PAYMENT_PENDING'] }
    }
  });

  // Count bookings where broker has prepared a quote or awaiting decision
  const pendingQuotesCount = await prisma.booking.count({
    where: {
      customer_id: customer.id,
      status: { in: ['QUOTE_REQUESTED', 'QUOTE_PREPARED'] }
    }
  });

  // Completed bookings count
  const completedBookingsCount = await prisma.booking.count({
    where: {
      customer_id: customer.id,
      status: { in: ['COMPLETED', 'CLOSED', 'DELIVERED', 'POD_VERIFIED'] }
    }
  });

  // Rejected / Cancelled count
  const rejectedBookingsCount = await prisma.booking.count({
    where: {
      customer_id: customer.id,
      status: { in: ['REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED'] }
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
    completedBookingsCount,
    rejectedBookingsCount,
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
      requirements: {
        none: {
          tag: 'QUOTE_DISMISSED',
        },
      },
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

const dismissQuotation = async (userId, bookingId) => {
  const customer = await prisma.customer.findUnique({
    where: { user_id: userId },
  });

  if (!customer) {
    throw new Error('Customer profile not found');
  }

  // Ensure booking belongs to this customer
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      customer_id: customer.id,
    },
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  // Create tag QUOTE_DISMISSED so it is hidden only from My Quotations without affecting Booking History
  await prisma.bookingRequirement.create({
    data: {
      booking_id: bookingId,
      tag: 'QUOTE_DISMISSED',
      value: 'true',
    },
  }).catch(() => {});

  return { success: true };
};

module.exports = { getCustomerDashboard, getMyQuotations, dismissQuotation };

