const { recommendVehicles } = require('../services/pricingService');
const { createBooking: createBookingService } = require('../services/bookingService');

const { prisma } = require('../config/db');
const { calculateETAAndPreparePayment } = require('../services/matchingService');

/**
 * GET /api/v1/bookings/vehicle-categories
 * Fetch active vehicle categories from DB for customer booking selection
 */
const getActiveVehicleCategories = async (req, res, next) => {
  try {
    const categories = await prisma.vehicleCategory.findMany({
      where: { is_active: true, is_deleted: false },
      orderBy: { base_price_per_km: 'asc' }
    });

    if (!categories || categories.length === 0) {
      const fallback = [
        { id: 'cat-1', name: 'Bakkie / Light Duty', description: 'Bakkies & light cargo vehicles', base_price_per_km: 12.00, capacity_tons: 1.0 },
        { id: 'cat-2', name: '4-Ton Truck', description: 'Medium closed box / flatbed truck', base_price_per_km: 18.00, capacity_tons: 4.0 },
        { id: 'cat-3', name: '8-Ton Truck', description: 'Heavy curtain-side or flatbed truck', base_price_per_km: 25.00, capacity_tons: 8.0 },
        { id: 'cat-4', name: '14-Ton Truck', description: 'Multi-axle heavy freight truck', base_price_per_km: 30.00, capacity_tons: 14.0 },
        { id: 'cat-5', name: '34-Ton Tri-Axle', description: 'Super heavy interlink tri-axle truck', base_price_per_km: 38.00, capacity_tons: 34.0 },
        { id: 'cat-6', name: 'Refrigerated Truck', description: 'Temperature-controlled cold room truck', base_price_per_km: 28.00, capacity_tons: 8.0 }
      ];
      return res.status(200).json({ success: true, data: fallback });
    }

    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Handles generating a quote recommendation (Step 4 of Booking Wizard)
 */
const getQuoteRecommendations = async (req, res, next) => {
  try {
    const { distanceKm, weightKg, requirements } = req.body;

    if (!distanceKm) {
      return res.status(400).json({ success: false, message: 'Distance is required.' });
    }

    const validWeightKg = weightKg ? Number(weightKg) : 1000;
    const options = recommendVehicles(Number(distanceKm), validWeightKg, requirements || []);

    res.status(200).json({
      success: true,
      data: options
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Handles finalizing the booking request
 */
const createBooking = async (req, res, next) => {
  await createBookingService(req, res, next);
};

/**
 * GET /api/v1/bookings/history
 * Fetch customer booking history with filters
 */
const getCustomerBookingsHistory = async (req, res, next) => {
  try {
    // Get the customer ID from the authenticated user
    let customer_id = req.user?.customer?.id;
    
    // If not directly attached by middleware, look it up from user ID
    if (!customer_id && req.user?.id) {
      const customer = await prisma.customer.findUnique({
        where: { user_id: req.user.id }
      });
      customer_id = customer?.id;
    }

    if (!customer_id) {
      return res.status(401).json({ success: false, message: 'Customer profile not found for this account.' });
    }

    const { status, search, vehicleType } = req.query;

    const whereClause = { customer_id, is_deleted: false };
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    if (search) {
      whereClause.OR = [
        { id: { contains: search } },
        { cargo_name: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (vehicleType) {
      whereClause.requested_vehicle = vehicleType;
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        quotes: { orderBy: { created_at: 'desc' }, take: 1 },
        assignments: {
          include: { 
            driver: { include: { user: true } }, 
            fleet_owner: { include: { user: true } }, 
            broker: true,
            vehicle: true
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/bookings/:id
 * Fetch single booking details
 */
const getBookingDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        quotes: true,
        requirements: true,
        documents: true,
        invoices: true,
        telemetry: true,
        assignments: {
          include: { 
            driver: { include: { user: true } }, 
            fleet_owner: { include: { user: true } },
            broker: { include: { user: true } },
            vehicle: true
          }
        }
      }
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Auto-synthesize invoice from quote if missing in DB
    if ((!booking.invoices || booking.invoices.length === 0) && booking.quotes && booking.quotes.length > 0) {
      const q = booking.quotes[0];
      const amt = Number(q.grand_total) || (Number(q.distance_cost || 0) + Number(q.platform_fee || 0) + Number(q.tax || 0) + Number(q.surcharge || 0)) || 98.80;
      booking.invoices = [{
        id: `inv-${booking.id.slice(0, 8)}`,
        booking_id: booking.id,
        total_amount: amt,
        subtotal: amt * 0.85,
        tax_amount: amt * 0.15,
        status: 'PENDING'
      }];
    }

    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/v1/bookings/:id/status
 * Update booking status
 */
const updateBookingStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    const booking = await prisma.booking.findUnique({ 
      where: { id },
      include: { quotes: true, customer: true }
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    let finalStatus = status;

    const updated = await prisma.$transaction(async (tx) => {
      // Phase 2: If customer accepts quote, auto-transition to ETA_CALCULATION to prepare for payment
      if (status === 'CUSTOMER_ACCEPTED') {
        finalStatus = 'ETA_CALCULATION';
      }

      const b = await tx.booking.update({
        where: { id },
        data: { status: finalStatus }
      });

      if (status === 'CUSTOMER_ACCEPTED' || status === 'BOOKING_CONFIRMED') {
        const acceptedQuote = await tx.quote.findFirst({
          where: { booking_id: id },
          orderBy: { created_at: 'desc' }
        });

        if (acceptedQuote && acceptedQuote.prepared_by) {
          await tx.quote.update({
            where: { id: acceptedQuote.id },
            data: { status: 'ACCEPTED' }
          });

          // Generate BookingSettlement
          const pricingConfig = await tx.pricingConfig.findFirst();
          const fleetPct = pricingConfig?.fleet_payout_pct ? Number(pricingConfig.fleet_payout_pct) : 70;
          const driverPct = pricingConfig?.driver_payout_pct ? Number(pricingConfig.driver_payout_pct) : 20;
          
          const baseEarnings = Number(acceptedQuote.grand_total) - Number(acceptedQuote.platform_fee) - Number(acceptedQuote.tax) - Number(acceptedQuote.broker_fee);
          const validBaseEarnings = Math.max(0, baseEarnings);
          const fleetOwnerExpectedEarnings = validBaseEarnings * (fleetPct / 100);
          const driverExpectedEarnings = validBaseEarnings * (driverPct / 100);

          await tx.bookingSettlement.upsert({
            where: { booking_id: id },
            update: {
              customerPaymentAmount: acceptedQuote.grand_total,
              platformFee: acceptedQuote.platform_fee,
              fleetOwnerExpectedEarnings,
              driverExpectedEarnings
            },
            create: {
              booking_id: id,
              customerPaymentAmount: acceptedQuote.grand_total,
              platformFee: acceptedQuote.platform_fee,
              fleetOwnerExpectedEarnings,
              driverExpectedEarnings
            }
          });

          // Upsert Invoice for Payment Checkout
          const totalAmt = Number(acceptedQuote.grand_total) || 98.80;
          const invNo = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
          const custId = booking.customer_id || 'guest';
          const subTotalAmt = Number((totalAmt / 1.15).toFixed(2));
          const taxTotalAmt = Number((totalAmt - subTotalAmt).toFixed(2));

          const existingInv = await tx.invoice.findFirst({ where: { booking_id: id } });
          if (existingInv) {
            await tx.invoice.update({
              where: { id: existingInv.id },
              data: {
                amount: subTotalAmt,
                tax_amount: taxTotalAmt,
                total_amount: totalAmt,
                status: 'ISSUED'
              }
            });
          } else {
            await tx.invoice.create({
              data: {
                invoice_no: invNo,
                booking_id: id,
                customer_id: custId,
                amount: subTotalAmt,
                tax_amount: taxTotalAmt,
                total_amount: totalAmt,
                status: 'ISSUED',
                due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              }
            });
          }
        }
      }

      // Tracking History
      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: finalStatus,
          remarks,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      // Activity Log
      await tx.activityLog.create({
        data: {
          user_id: req.user?.id,
          action: `STATUS_UPDATED_${finalStatus}`,
          description: `Booking ${id} status updated to ${finalStatus}. ${remarks || ''}`
        }
      });

      // Invoice generation is removed from here. It will now happen during calculateETAAndPreparePayment.
      if (finalStatus === 'ETA_CALCULATION') {
        // We will trigger the ETA calculation below, outside the transaction.
      }

      // Phase 2: Payout logic ONLY triggered on COMPLETED (Delivery verified)
      if (finalStatus === 'COMPLETED') {
        const existingInvoice = await tx.invoice.findFirst({
          where: { booking_id: id }
        });
        
        if (existingInvoice) {
          const payoutAmount = Number(existingInvoice.payout_amount);

          // Resolve Transporter to credit payout to their Wallet!
          const assignment = await tx.bookingAssignment.findFirst({
            where: { booking_id: id, status: 'ACTIVE' }
          });

          let payeeUserId = null;
          if (assignment) {
            if (assignment.fleet_owner_id) {
              const fleetOwner = await tx.fleetOwner.findUnique({
                where: { id: assignment.fleet_owner_id }
              });
              if (fleetOwner) payeeUserId = fleetOwner.user_id;
            } else if (assignment.driver_id) {
              const driver = await tx.driver.findUnique({
                where: { id: assignment.driver_id }
              });
              if (driver) payeeUserId = driver.user_id;

              await tx.driver.update({
                where: { id: assignment.driver_id },
                data: { status: 'AVAILABLE' }
              });
            }
          }

          if (payeeUserId) {
            let wallet = await tx.wallet.findFirst({
              where: { user_id: payeeUserId }
            });

            if (!wallet) {
              wallet = await tx.wallet.create({
                data: {
                  user_id: payeeUserId,
                  balance: 0,
                  pending_balance: 0
                }
              });
            }

            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                balance: { increment: payoutAmount }
              }
            });

            await tx.walletTransaction.create({
              data: {
                wallet_id: wallet.id,
                type: 'CREDIT',
                amount: payoutAmount,
                description: `Payout for load delivery (Booking ID: ${id.slice(0, 8)})`,
                reference_id: id
              }
            });
          }
        }
      }

      return b;
    });

    // TRIGGER: If status is now ETA_CALCULATION, initiate ETA calc & invoice creation
    if (finalStatus === 'ETA_CALCULATION') {
      const io = req.app ? req.app.get('io') : null;
      await calculateETAAndPreparePayment(id, [], io);
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBookingTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const history = await prisma.trackingHistory.findMany({
      where: { booking_id: id },
      orderBy: { timestamp: 'asc' }
    });
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const acceptBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const driverId = req.user?.driver?.id;
    const fleetOwnerId = req.user?.fleet_owner?.id;

    const updated = await prisma.$transaction(async (tx) => {
      // Find the pending assignment for this driver or fleet owner
      const assignment = await tx.bookingAssignment.findFirst({
        where: {
          booking_id: id,
          OR: [
            driverId ? { driver_id: driverId } : undefined,
            fleetOwnerId ? { fleet_owner_id: fleetOwnerId } : undefined
          ].filter(Boolean),
          status: 'PENDING'
        }
      });

      if (assignment) {
        await tx.bookingAssignment.update({
          where: { id: assignment.id },
          data: { status: 'ACTIVE' }
        });
      }

      // If driver accepted, keep the status as DRIVER_ASSIGNED (which is the active trip status)
      // otherwise fallback to BOOKING_CONFIRMED.
      const newStatus = booking.status === 'DRIVER_ASSIGNED' ? 'DRIVER_ASSIGNED' : 'BOOKING_CONFIRMED';

      const b = await tx.booking.update({
        where: { id },
        data: { status: newStatus }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: newStatus,
          remarks: req.user?.role === 'DRIVER' ? 'Driver accepted the trip assignment' : 'Fleet Owner accepted the booking assignment',
          updated_by: req.user?.id || 'SYSTEM'
        }
      });
      return b;
    });

    res.status(200).json({ success: true, data: updated, message: 'Booking assignment accepted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const driverId = req.user?.driver?.id;
    const fleetOwnerId = req.user?.fleet_owner?.id;
    const newStatus = 'DRIVER_SEARCHING';
    
    const updated = await prisma.$transaction(async (tx) => {
      // Find and delete the pending assignment
      await tx.bookingAssignment.deleteMany({
        where: {
          booking_id: id,
          OR: [
            driverId ? { driver_id: driverId } : undefined,
            fleetOwnerId ? { fleet_owner_id: fleetOwnerId } : undefined
          ].filter(Boolean)
        }
      });

      const b = await tx.booking.update({
        where: { id },
        data: { status: newStatus }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: newStatus,
          remarks: req.user?.role === 'DRIVER' ? 'Driver rejected the trip assignment. Searching for new driver.' : 'Fleet Owner rejected the assignment. Searching for new transporter.',
          updated_by: req.user?.id || 'SYSTEM'
        }
      });
      return b;
    });

    res.status(200).json({ success: true, data: updated, message: 'Booking assignment rejected' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        assignments: true,
        invoices: { where: { status: 'PAID' } }
      }
    });
    
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.status === 'CANCELLED') return res.status(400).json({ success: false, message: 'Booking already cancelled' });

    // Ensure it's not already in transit
    if (['DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'PICKUP_ARRIVED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel booking in progress' });
    }

    const hasActiveAssignment = booking.assignments.some(a => a.status === 'ACTIVE');
    const invoice = booking.invoices[0];

    const updated = await prisma.$transaction(async (tx) => {
      // Mark booking as cancelled
      const b = await tx.booking.update({
        where: { id },
        data: { status: 'CANCELLED' }
      });

      // Tracking History
      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: 'CANCELLED',
          remarks: 'Customer cancelled the booking.',
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      // Refund logic for pre-paid phase 2
      if (invoice && !hasActiveAssignment) {
        // Customer paid, but no fleet/driver is actively assigned
        // Issue 100% refund
        let customerWallet = await tx.wallet.findFirst({ where: { user_id: req.user.id } });
        if (!customerWallet) {
          customerWallet = await tx.wallet.create({ data: { user_id: req.user.id, balance: 0 } });
        }

        await tx.wallet.update({
          where: { id: customerWallet.id },
          data: { balance: { increment: invoice.total_amount } }
        });

        await tx.walletTransaction.create({
          data: {
            wallet_id: customerWallet.id,
            type: 'CREDIT',
            amount: invoice.total_amount,
            description: `Refund for Cancelled Booking ${id}`,
            reference_id: id,
            status: 'COMPLETED'
          }
        });

        await tx.trackingHistory.create({
          data: {
            booking_id: id,
            status: 'CANCELLED',
            remarks: '100% Refund credited to customer wallet.',
            updated_by: 'SYSTEM'
          }
        });
      }

      return b;
    });

    res.status(200).json({ success: true, data: updated, message: 'Booking cancelled successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getActiveVehicleCategories,
  getQuoteRecommendations,
  createBooking,
  getCustomerBookingsHistory,
  getBookingDetails,
  updateBookingStatus,
  getBookingTimeline,
  acceptBooking,
  rejectBooking,
  cancelBooking
};
