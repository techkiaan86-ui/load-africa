const { prisma } = require('../config/db');
const { fallbackMatching } = require('../services/matchingService');

// Helper to get actual driver ID or operator ID
const getDriverId = async (req) => {
  if (req.user?.driver?.id) return req.user.driver.id;
  if (req.user?.operator?.id) return req.user.operator.id;

  const driver = await prisma.driver.findUnique({ where: { user_id: req.user.id } });
  if (driver) return driver.id;

  const operator = await prisma.machineOperator.findUnique({ where: { user_id: req.user.id } });
  if (operator) return operator.id;

  return null;
};

const getAvailableLoads = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    // Fetch bookings where status = DRIVER_OFFER_SENT for this driver OR DRIVER_SEARCHING OR DRIVER_ASSIGNED PENDING
    const loads = await prisma.booking.findMany({
      where: {
        is_deleted: false,
        OR: [
          {
            status: 'DRIVER_OFFER_SENT',
            offers: { some: { driver_id: driverId, status: 'PENDING' } }
          },
          {
            status: 'DRIVER_SEARCHING',
            applications: { none: { driver_id: driverId } }
          },
          {
            status: 'DRIVER_ASSIGNED',
            assignments: { some: { driver_id: driverId, status: 'PENDING' } }
          }
        ]
      },
      include: {
        customer: { include: { user: { select: { first_name: true, last_name: true, email: true, phone: true } } } },
        assignments: { where: { driver_id: driverId, status: 'PENDING' } },
        offers: { where: { driver_id: driverId, status: 'PENDING' } }
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ success: true, data: loads });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const applyForLoad = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = await getDriverId(req);

    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true, assigned_vehicle: true }
    });

    if (!driver) return res.status(404).json({ success: false, message: 'Driver details not found' });
    if (driver.user?.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Driver account is not active.' });
    if (driver.status === 'ON_TRIP') return res.status(400).json({ success: false, message: 'Driver is currently on another active trip.' });

    // Check if booking is available globally or assigned to this driver
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { 
        assignments: true,
        offers: { where: { driver_id: driverId, status: 'PENDING' } }
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Concurrency Lock: Check if another driver has already accepted this booking
    const activeAssignment = booking.assignments.find(a => a.status === 'ACTIVE');
    if (activeAssignment) {
      return res.status(400).json({ success: false, message: 'This load has already been accepted by another driver.' });
    }

    const assignment = await prisma.$transaction(async (tx) => {
      // 1. Update Driver's pending LoadOffer if exists
      if (booking.offers.length > 0) {
        await tx.loadOffer.update({
          where: { id: booking.offers[0].id },
          data: { status: 'ACCEPTED' }
        });
      }

      // 2. Create or Update BookingAssignment to ACTIVE
      let ass = booking.assignments.find(a => a.driver_id === driverId);
      if (ass) {
        ass = await tx.bookingAssignment.update({
          where: { id: ass.id },
          data: {
            status: 'ACTIVE',
            fleet_owner_id: driver.fleet_owner_id,
            vehicle_id: driver.assigned_vehicle_id
          }
        });
      } else {
        ass = await tx.bookingAssignment.create({
          data: {
            booking_id: bookingId,
            driver_id: driverId,
            fleet_owner_id: driver.fleet_owner_id,
            vehicle_id: driver.assigned_vehicle_id,
            status: 'ACTIVE',
            assigned_by: req.user?.id || driverId
          }
        });
      }

      // 3. Update Booking status to DRIVER_ASSIGNED
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'DRIVER_ASSIGNED' }
      });

      // 4. Update Driver & Vehicle status to ON_TRIP
      await tx.driver.update({
        where: { id: driverId },
        data: { status: 'ON_TRIP' }
      });

      if (driver.assigned_vehicle_id) {
        await tx.vehicle.update({
          where: { id: driver.assigned_vehicle_id },
          data: { status: 'ON_TRIP' }
        });
      }

      await tx.trackingHistory.create({
        data: { 
          booking_id: bookingId, 
          status: 'DRIVER_ASSIGNED', 
          remarks: `Driver ${driver.user?.first_name || ''} ${driver.user?.last_name || ''} accepted load. Trip active.`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      await tx.activityLog.create({
        data: { user_id: req.user?.id, action: 'DRIVER_ACCEPTED', description: `Driver accepted booking ${bookingId}` }
      });

      return ass;
    });

    const io = req.app ? req.app.get('io') : null;
    if (io) {
      io.emit(`booking_status_updated_${bookingId}`, { status: 'DRIVER_ASSIGNED' });
    }

    res.status(200).json({ success: true, message: 'Load accepted successfully.', data: assignment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectLoad = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const driverId = await getDriverId(req);
    
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    const booking = await prisma.booking.findUnique({ 
      where: { id: bookingId },
      include: { 
        assignments: { where: { driver_id: driverId } },
        offers: { where: { driver_id: driverId, status: 'PENDING' } }
      }
    });

    if (!booking || (booking.assignments.length === 0 && booking.offers.length === 0)) {
      return res.status(400).json({ success: false, message: 'No pending offer or assignment found for this load' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Mark driver offer as REJECTED
      if (booking.offers.length > 0) {
        await tx.loadOffer.update({
          where: { id: booking.offers[0].id },
          data: { status: 'REJECTED', rejection_reason: reason || 'Driver declined offer' }
        });
      }

      // 2. Mark assignment as REJECTED if exists
      if (booking.assignments.length > 0) {
        await tx.bookingAssignment.update({
          where: { id: booking.assignments[0].id },
          data: { status: 'REJECTED' }
        });
      }

      // 3. Mark booking back to TRANSPORTER_SEARCHING (Fallback trigger)
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'TRANSPORTER_SEARCHING' }
      });

      await tx.trackingHistory.create({
        data: { 
          booking_id: bookingId, 
          status: 'TRANSPORTER_SEARCHING', 
          remarks: `Driver rejected load. Reason: ${reason || 'Not specified'}. Searching for replacement transporter...`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });
      
      await tx.activityLog.create({
        data: { user_id: req.user?.id, action: 'DRIVER_REJECTED', description: `Driver rejected booking ${bookingId}` }
      });
    });

    // TRIGGER FALLBACK MATCHING
    const { fallbackMatching } = require('../services/matchingService');
    const io = req.app ? req.app.get('io') : null;
    await fallbackMatching(bookingId, driverId, io);

    res.status(200).json({ success: true, message: 'Load rejected successfully. Finding alternative driver/transporter.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getActiveTrip = async (req, res) => {
  try {
    const driverId = await getDriverId(req);

    // An active trip is an ACTIVE assigned booking that is not completed or cancelled
    const activeTrip = await prisma.bookingAssignment.findFirst({
      where: {
        OR: [
          { driver_id: driverId },
          { operator_id: driverId }
        ],
        status: 'ACTIVE',
        booking: {
          status: {
            in: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'LOADING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'DELIVERED', 'POD_UPLOADED']
          }
        }
      },
      include: {
        booking: {
          include: {
            customer: { include: { user: { select: { first_name: true, last_name: true, email: true, phone: true } } } },
            quotes: true,
            tripPerformance: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: activeTrip ? {
        ...activeTrip.booking,
        assignmentStatus: activeTrip.status
      } : null
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateTripStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, remarks } = req.body;
    const driverId = await getDriverId(req);

    // Ensure driver is assigned to this booking
    const assignment = await prisma.bookingAssignment.findFirst({
      where: {
        booking_id: bookingId,
        OR: [
          { driver_id: driverId },
          { operator_id: driverId }
        ]
      }
    });

    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this trip' });
    }

    // Payment Validation Guard: Ensure customer has paid before driver can start/progress trip
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { invoices: true }
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const isPaid = booking.status === 'PAYMENT_RECEIVED' || 
      booking.status === 'IN_TRANSIT' || 
      booking.status === 'DRIVER_EN_ROUTE' || 
      booking.status === 'ARRIVED_PICKUP' || 
      booking.status === 'PICKED_UP' || 
      booking.status === 'LOADING' || 
      booking.status === 'COMPLETED' || 
      (booking.invoices && booking.invoices.some(inv => inv.status === 'PAID'));

    if (!isPaid && status !== 'CANCELLED') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot start trip until Customer payment is received.' 
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: bookingId },
        data: { status },
        include: { quotes: true }
      });

      await tx.trackingHistory.create({
        data: { booking_id: bookingId, status, remarks: remarks || `Driver marked as ${status}` }
      });

      if (status === 'COMPLETED' || status === 'POD_UPLOADED') {
        await tx.driver.update({
          where: { id: driverId },
          data: { status: 'AVAILABLE' }
        });

        const dRec = await tx.driver.findUnique({ where: { id: driverId } });
        if (dRec && dRec.assigned_vehicle_id) {
          await tx.vehicle.update({
            where: { id: dRec.assigned_vehicle_id },
            data: { status: 'AVAILABLE' }
          });
        }

        await tx.bookingAssignment.updateMany({
          where: { booking_id: bookingId },
          data: { status: 'COMPLETED' }
        });

        // Check if payout was already released
        const existingTx = await tx.walletTransaction.findFirst({
          where: { reference_id: bookingId, type: 'CREDIT' }
        });

        if (!existingTx) {
          const invoice = await tx.invoice.findFirst({
            where: { booking_id: bookingId }
          });

          const totalAmount = invoice ? Number(invoice.total_amount) : (b.quotes.length > 0 ? Number(b.quotes[0].grand_total) : 100);
          const fleetOwnerAmount = totalAmount * 0.70;
          const driverAmount = totalAmount * 0.20;
          const platformAmount = totalAmount * 0.10;

          // 1. Credit Fleet Owner Wallet
          const assignment = await tx.bookingAssignment.findFirst({
            where: { booking_id: bookingId }
          });
          const fleetOwnerId = assignment?.fleet_owner_id;

          if (fleetOwnerId) {
            const fleet = await tx.fleetOwner.findUnique({ where: { id: fleetOwnerId } });
            if (fleet && fleet.user_id) {
              let fWallet = await tx.wallet.findFirst({ where: { user_id: fleet.user_id } });
              if (!fWallet) fWallet = await tx.wallet.create({ data: { user_id: fleet.user_id, balance: 0 } });
              await tx.wallet.update({
                where: { id: fWallet.id },
                data: { balance: { increment: fleetOwnerAmount } }
              });
              await tx.walletTransaction.create({
                data: {
                  wallet_id: fWallet.id,
                  type: 'CREDIT',
                  amount: fleetOwnerAmount,
                  description: `Fleet Owner Earnings for Booking ${bookingId.slice(0, 8)}`,
                  reference_id: bookingId,
                  status: 'COMPLETED'
                }
              });
            }
          }

          // 2. Credit Driver Wallet
          const driver = await tx.driver.findUnique({ where: { id: driverId } });
          if (driver && driver.user_id) {
            let dWallet = await tx.wallet.findFirst({ where: { user_id: driver.user_id } });
            if (!dWallet) dWallet = await tx.wallet.create({ data: { user_id: driver.user_id, balance: 0 } });
            await tx.wallet.update({
              where: { id: dWallet.id },
              data: { balance: { increment: driverAmount } }
            });
            await tx.walletTransaction.create({
              data: {
                wallet_id: dWallet.id,
                type: 'CREDIT',
                amount: driverAmount,
                description: `Driver Earnings for Booking ${bookingId.slice(0, 8)}`,
                reference_id: bookingId,
                status: 'COMPLETED'
              }
            });
          }

          // 3. Credit Admin Wallet
          let adminUser = await tx.user.findFirst({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } } });
          if (adminUser) {
            let aWallet = await tx.wallet.findFirst({ where: { user_id: adminUser.id } });
            if (!aWallet) aWallet = await tx.wallet.create({ data: { user_id: adminUser.id, balance: 0 } });
            await tx.wallet.update({
              where: { id: aWallet.id },
              data: { balance: { increment: platformAmount } }
            });
            await tx.walletTransaction.create({
              data: {
                wallet_id: aWallet.id,
                type: 'CREDIT',
                amount: platformAmount,
                description: `Platform Fee (10%) for Booking ${bookingId.slice(0, 8)}`,
                reference_id: bookingId,
                status: 'COMPLETED'
              }
            });
          }

          if (invoice) {
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: 'PAID',
                platform_commission: platformAmount,
                payout_amount: fleetOwnerAmount + driverAmount
              }
            });
          }
        }
      }

      return b;
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDriverHistory = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const history = await prisma.bookingAssignment.findMany({
      where: {
        driver_id: driverId,
        booking: {
          status: {
            in: ['COMPLETED', 'CLOSED', 'CANCELLED']
          }
        }
      },
      include: { booking: { include: { customer: { include: { user: { select: { first_name: true, last_name: true, email: true } } } } } } },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: history.map(h => h.booking) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDriverDashboard = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    // 1. Fetch driver with all profile info
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: true,
        approval: true,
        profile: true,
        photos: true,
        kyc: true,
        assigned_vehicle: true,
        fleet_owner: { include: { user: true } },
        compliance: true,
        status_history: {
          orderBy: { created_at: 'desc' },
          take: 50
        }
      }
    });

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver record not found in database' });
    }

    // 2. Fetch completed loads (trips)
    const completedLoads = await prisma.bookingAssignment.count({
      where: { driver_id: driverId, booking: { status: 'COMPLETED', is_deleted: false } }
    });

    // 3. Fetch active trips
    const activeTripsCount = await prisma.bookingAssignment.count({
      where: {
        driver_id: driverId,
        booking: {
          status: {
            in: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'LOADING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'DELIVERED', 'POD_UPLOADED']
          },
          is_deleted: false
        }
      }
    });

    // 4. Fetch available loads count
    const availableLoadsCount = await prisma.booking.count({
      where: { status: 'DRIVER_SEARCHING', is_deleted: false }
    });

    // 5. Fetch Wallet
    const wallet = await prisma.wallet.findFirst({
      where: { user_id: driver.user_id }
    });

    // 6. Rating (mocked to 5.0 for now since Review model is absent)
    const avgRating = 5.0;

    // 7. Check if documents exist
    const docs = await prisma.driverDocuments.findUnique({ where: { driver_id: driverId } });
    // If the fleet owner sets the driver to ACTIVE, they are considered verified/eligible.
    const documentsValid = driver.status === 'ACTIVE' || driver.user.status === 'ACTIVE' || !!(docs?.govt_id && docs?.license_front && docs?.license_back);

    res.status(200).json({
      success: true,
      data: {
        documentsValid,
        kycStatus: documentsValid ? 'APPROVED' : 'NOT_STARTED', // Fallback for UI if needed
        driverPhoto: driver.photos?.profile_photo || driver.user.avatar || null,
        verificationBadge: documentsValid ? 'VERIFIED' : 'PENDING',
        currentStatus: driver.status,
        walletBalance: wallet ? Number(wallet.balance) : 0.00,
        ratings: parseFloat(avgRating.toFixed(1)),
        trips: activeTripsCount,
        completedLoads: completedLoads,
        availableLoads: availableLoadsCount,
        vehicle: driver.assigned_vehicle
          ? { manufacturer: driver.assigned_vehicle.brand, model: driver.assigned_vehicle.model, reg: driver.assigned_vehicle.registration_number, capacity: driver.assigned_vehicle.capacity }
          : null,
        fleetOwner: driver.fleet_owner?.company_name || null,
        compliance: driver.compliance && driver.compliance.length > 0 ? driver.compliance[0] : null,
        statusHistory: driver.status_history || []
      }
    });
  } catch (error) {
    console.error('[getDriverDashboard] Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const completeOnboarding = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    // Update DriverProfile onboarding_completed to true
    await prisma.driverProfile.update({
      where: { driver_id: driverId },
      data: { onboarding_completed: true }
    });

    // Update DriverKYC to reflect verified status
    await prisma.driverKYC.update({
      where: { driver_id: driverId },
      data: {
        phone_verified: true,
        gps_enabled: true,
        terms_accepted: true,
        training_completed: true
      }
    });

    await prisma.activityLog.create({
      data: {
        user_id: req.user.id,
        action: 'DRIVER_ONBOARDING_COMPLETED',
        description: `Driver completed first-login onboarding checklist.`
      }
    });

    res.status(200).json({ success: true, message: 'Onboarding completed successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitKYC = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const { license, pdp, id_document } = req.body;

    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        license,
        pdp,
        id_document,
        status: 'UNDER_REVIEW'
      }
    });

    await prisma.driverApproval.upsert({
      where: { driver_id: driverId },
      update: { status: 'PENDING', rejection_reason: null },
      create: { driver_id: driverId, status: 'PENDING' }
    });

    res.status(200).json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    res.status(200).json({
      success: true,
      data: {
        first_name: driver.user.first_name || '',
        last_name: driver.user.last_name || '',
        email: driver.user.email,
        phone: driver.user.phone || '',
        avatar: driver.user.avatar || '',
        bank_details: (() => {
          try { return driver.user.bank_details ? JSON.parse(driver.user.bank_details) : {}; }
          catch (e) { return {}; }
        })(),
        notification_preferences: (() => {
          try { return driver.user.notification_preferences ? JSON.parse(driver.user.notification_preferences) : { sms: true, email: true, push: true }; }
          catch (e) { return { sms: true, email: true, push: true }; }
        })()
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const driver = await prisma.driver.findUnique({
      where: { id: driverId }
    });
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    const { first_name, last_name, phone, bank_details, avatar, notification_preferences } = req.body;

    await prisma.user.update({
      where: { id: driver.user_id },
      data: {
        first_name: first_name !== undefined ? first_name : undefined,
        last_name: last_name !== undefined ? last_name : undefined,
        phone: phone !== undefined ? phone : undefined,
        avatar: avatar !== undefined ? avatar : undefined,
        bank_details: bank_details !== undefined ? (typeof bank_details === 'object' ? JSON.stringify(bank_details) : bank_details) : undefined,
        notification_preferences: notification_preferences !== undefined ? (typeof notification_preferences === 'object' ? JSON.stringify(notification_preferences) : notification_preferences) : undefined,
      }
    });

    res.status(200).json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateTelemetry = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { latitude, longitude, speed, heading } = req.body;
    const driverId = await getDriverId(req);

    const assignment = await prisma.bookingAssignment.findFirst({
      where: { booking_id: bookingId, driver_id: driverId }
    });
    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Not authorized to update tracking for this trip' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId }
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const startLat = booking.pickup_coords_lat;
    const startLng = booking.pickup_coords_lng;
    const endLat = booking.delivery_coords_lat;
    const endLng = booking.delivery_coords_lng;

    const calcDist = (lat1, lon1, lat2, lon2) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return parseFloat((R * c).toFixed(2));
    };

    const completed = calcDist(startLat, startLng, latitude, longitude);
    const remaining = calcDist(latitude, longitude, endLat, endLng);

    const etaMs = remaining > 0 ? (remaining / 50) * 60 * 60 * 1000 : 0;
    const etaDate = new Date(Date.now() + etaMs);

    const telemetry = await prisma.$transaction(async (tx) => {
      // 1. Update current position in Booking
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          current_latitude: parseFloat(latitude),
          current_longitude: parseFloat(longitude)
        }
      });

      // 2. Upsert LiveTrackingTelemetry
      const tel = await tx.liveTrackingTelemetry.upsert({
        where: { booking_id: bookingId },
        update: {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          completed_distance: completed,
          remaining_distance: remaining,
          eta: etaDate
        },
        create: {
          booking_id: bookingId,
          driver_id: driverId,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          completed_distance: completed,
          remaining_distance: remaining,
          eta: etaDate
        }
      });

      // 3. Log to tracking history
      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: booking.status,
          lat: parseFloat(latitude),
          lng: parseFloat(longitude),
          remarks: `Live telemetry update. Completed: ${completed} km. Remaining: ${remaining} km. Speed: ${speed || 0} km/h. Heading: ${heading || 0}°.`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      return tel;
    });

    const io = req.app.get('io');
    if (io) {
      io.emit(`telemetry_updated_${bookingId}`, {
        bookingId,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        completed_distance: completed,
        remaining_distance: remaining,
        eta: etaDate,
        speed: speed || 0,
        heading: heading || 0,
        updatedAt: new Date().toISOString()
      });
    }

    res.status(200).json({ success: true, data: telemetry });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleOnlineStatus = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const { isOnline, latitude, longitude } = req.body;

    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    // Validate eligibility if going online
    if (isOnline) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: { 
          documents_relation: true, 
          compliance: true, 
          assignments: { 
            where: { 
              status: 'ACTIVE',
              booking: { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
            } 
          } 
        }
      });
      
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
      
      const docs = driver.documents_relation;
      // Fleet drivers are pre-approved by their Fleet Owner.
      const documentsValid = !!driver.fleet_owner_id || driver.status === 'ACTIVE' || !!(docs?.govt_id && docs?.license_front && docs?.license_back);

      if (!documentsValid) {
        return res.status(400).json({ success: false, message: 'Complete your required documents via Fleet Manager to become eligible.' });
      }
      if (!driver.assigned_vehicle_id) {
        return res.status(400).json({ success: false, message: 'Vehicle assignment required before receiving load offers.' });
      }
      if (driver.assignments.length > 0) {
        return res.status(400).json({ success: false, message: 'Cannot go online while on an active trip.' });
      }
    }
    
    const newStatus = isOnline ? 'AVAILABLE' : 'INACTIVE';

    await prisma.$transaction(async (tx) => {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      const oldStatus = driver.status;

      await tx.driver.update({
        where: { id: driverId },
        data: { status: newStatus }
      });

      if (oldStatus !== newStatus) {
        await tx.driverStatusHistory.create({
          data: {
            driver_id: driverId,
            old_status: oldStatus,
            new_status: newStatus,
            change_reason: isOnline ? 'Driver went online (Radar Active)' : 'Driver went offline'
          }
        });
      }

      await tx.driverProfile.upsert({
        where: { driver_id: driverId },
        update: {
          gps_lat: latitude ? parseFloat(latitude) : null,
          gps_lng: longitude ? parseFloat(longitude) : null
        },
        create: {
          driver_id: driverId,
          gps_lat: latitude ? parseFloat(latitude) : null,
          gps_lng: longitude ? parseFloat(longitude) : null
        }
      });
    });

    res.status(200).json({ success: true, message: `Driver is now ${isOnline ? 'online' : 'offline'}` });
  } catch (error) {
    console.error('[toggleOnlineStatus] Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getKYCDocuments = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    let documents = await prisma.driverDocuments.findUnique({
      where: { driver_id: driverId }
    });

    if (!documents) {
      documents = await prisma.driverDocuments.create({
        data: { driver_id: driverId }
      });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        approval: true,
        profile: true,
        kyc: true,
        user: true,
        photos: true
      }
    });

    const allDocuments = {
      ...documents,
      profile_photo: driver.photos?.profile_photo || null,
      selfie: driver.photos?.selfie || null,
    };

    res.status(200).json({
      success: true,
      data: {
        documents: allDocuments,
        status: driver.status,
        approval: driver.approval,
        profileDetails: {
          fullName: driver.user ? `${driver.user.first_name || ''} ${driver.user.last_name || ''}`.trim() : '',
          email: driver.user?.email || '',
          phone: driver.user?.phone || '',
          dob: driver.profile?.date_of_birth || '',
          gender: driver.profile?.gender || '',
          nationalId: driver.national_id || driver.kyc?.national_id || '',
          licenseNumber: driver.license || driver.kyc?.license_number || '',
          licenseExpiry: driver.license_expiry || driver.kyc?.license_expiry || '',
          address: driver.address || driver.profile?.address || '',
          city: driver.profile?.city || '',
          province: driver.profile?.province || '',
          emergencyContactName: driver.profile?.emergency_contact?.name || '',
          emergencyContactPhone: driver.profile?.emergency_contact?.phone || ''
        }
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadKYCDocument = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    const { docKey, fileUrl } = req.body;
    if (!docKey || !fileUrl) {
      return res.status(400).json({ success: false, message: 'Document key and file URL are required' });
    }

    const documents = await prisma.driverDocuments.upsert({
      where: { driver_id: driverId },
      update: { [docKey]: fileUrl },
      create: { driver_id: driverId, [docKey]: fileUrl }
    });

    await prisma.driver.update({
      where: { id: driverId },
      data: { status: 'PENDING' }
    });

    const d = await prisma.driver.findUnique({ where: { id: driverId } });
    await prisma.user.update({
      where: { id: d.user_id },
      data: { status: 'PENDING' }
    });

    await prisma.driverApproval.upsert({
      where: { driver_id: driverId },
      update: { status: 'PENDING', rejection_reason: null },
      create: { driver_id: driverId, status: 'PENDING' }
    });

    res.status(200).json({ success: true, data: documents });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPendingOffers = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    if (!driverId) return res.status(404).json({ success: false, message: 'Driver profile not found' });

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { 
        assignments: { 
          where: { 
            status: 'ACTIVE',
            booking: { status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] } }
          } 
        } 
      }
    });

    const offers = await prisma.loadOffer.findMany({
      where: {
        driver_id: driverId,
        status: 'PENDING',
        booking: { 
          is_deleted: false,
          status: { in: ['TRANSPORTER_ASSIGNMENT', 'DRIVER_SEARCHING', 'DRIVER_OFFER_SENT', 'PAYMENT_RECEIVED'] }
        }
      },
      include: {
        booking: {
          include: { 
            customer: { include: { user: true } },
            settlement: true
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ 
      success: true, 
      data: offers,
      isOnTrip: driver?.status === 'ON_TRIP' || (driver?.assignments && driver.assignments.length > 0)
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const acceptOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const driverId = await getDriverId(req);

    const offer = await prisma.loadOffer.findFirst({
      where: { id: offerId, driver_id: driverId, status: 'PENDING', booking: { is_deleted: false } },
      include: { booking: true }
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found or already processed' });
    }

    const driverCheck = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { 
        approval: true, 
        assignments: { 
          where: { 
            status: 'ACTIVE',
            booking: { status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] } }
          } 
        } 
      }
    });

    if (!driverCheck || driverCheck.is_deleted || driverCheck.status !== 'AVAILABLE') {
      return res.status(400).json({ success: false, message: 'Driver is not available to accept this offer.' });
    }
    if (!driverCheck.assigned_vehicle_id) {
      return res.status(400).json({ success: false, message: 'Driver does not have an assigned vehicle.' });
    }
    if (driverCheck.assignments.length > 0) {
      return res.status(400).json({ success: false, message: 'Driver is already on an active trip.' });
    }

    const assignment = await prisma.$transaction(async (tx) => {
      // Mark offer accepted
      await tx.loadOffer.update({
        where: { id: offerId },
        data: { status: 'ACCEPTED' }
      });

      // Update booking to DRIVER_ASSIGNED
      await tx.booking.update({
        where: { id: offer.booking_id },
        data: { status: 'DRIVER_ASSIGNED' }
      });

      // Update driver to ON_TRIP
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      const oldStatus = driver.status;

      await tx.driver.update({
        where: { id: driverId },
        data: { status: 'ON_TRIP' }
      });
      
      if (driver.assigned_vehicle_id) {
        await tx.vehicle.update({
          where: { id: driver.assigned_vehicle_id },
          data: { status: 'ON_TRIP' }
        });
      }

      await tx.driverStatusHistory.create({
        data: {
          driver_id: driverId,
          old_status: oldStatus,
          new_status: 'ON_TRIP',
          change_reason: `Accepted Load Offer for Booking ${offer.booking_id}`
        }
      });

      // Create Booking Assignment
      const ass = await tx.bookingAssignment.create({
        data: {
          booking_id: offer.booking_id,
          driver_id: driverId,
          fleet_owner_id: driver.fleet_owner_id,
          vehicle_id: driver.assigned_vehicle_id,
          status: 'ACTIVE',
          assigned_by: 'SYSTEM'
        }
      });

      await tx.trackingHistory.create({
        data: { booking_id: offer.booking_id, status: 'DRIVER_ASSIGNED', remarks: 'Driver accepted load. Trip is now active.' }
      });

      return ass;
    });

    res.status(200).json({ success: true, data: assignment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const { reason } = req.body;
    const driverId = await getDriverId(req);

    const offer = await prisma.loadOffer.findFirst({
      where: { id: offerId, driver_id: driverId, status: 'PENDING' }
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found or already processed' });
    }

    await prisma.$transaction(async (tx) => {
      // Mark offer rejected
      await tx.loadOffer.update({
        where: { id: offerId },
        data: { status: 'REJECTED', rejection_reason: reason || 'No reason provided' }
      });

      // Revert booking status so fallback matching can pick it up
      await tx.booking.update({
        where: { id: offer.booking_id },
        data: { status: 'LOOKING_FOR_TRANSPORTER' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: offer.booking_id,
          status: 'LOOKING_FOR_TRANSPORTER',
          remarks: `Driver rejected load offer. Reason: ${reason || 'None'}. Searching for next eligible transporter.`,
          updated_by: req.user.id
        }
      });

      // Log it
      await tx.activityLog.create({
        data: { action: 'LOAD_REJECTED', description: `Driver rejected offer for booking ${offer.booking_id}. Reason: ${reason || 'None'}` }
      });
    });

    // Search next driver/transporter in background using standard matching
    const { fallbackMatching } = require('../services/matchingService');
    setTimeout(() => {
      fallbackMatching(offer.booking_id, driverId).catch(console.error);
    }, 500);

    res.status(200).json({ success: true, message: 'Offer rejected successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitCompliance = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const { uniform_standards, hygiene, documentation } = req.body;

    let compliance = await prisma.driverCompliance.findFirst({
      where: { driver_id: driverId }
    });

    if (compliance) {
      compliance = await prisma.driverCompliance.update({
        where: { id: compliance.id },
        data: { uniform_standards, hygiene, documentation, last_updated: new Date() }
      });
    } else {
      compliance = await prisma.driverCompliance.create({
        data: {
          driver_id: driverId,
          uniform_standards,
          hygiene,
          documentation
        }
      });
    }

    res.status(200).json({ success: true, data: compliance });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updatePerformance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;
    const { milestone, weight } = req.body;

    // Determine if user is a Driver or Operator
    let driverId = null;
    const driver = await prisma.driver.findUnique({ where: { user_id: userId } });
    if (driver) {
      driverId = driver.id;
    } else {
      // User is an operator — try to find a driver from the assignment, or skip
      const assignment = await prisma.bookingAssignment.findFirst({
        where: { booking_id: bookingId },
        include: { booking: true }
      });
      if (assignment?.driver_id) {
        driverId = assignment.driver_id;
      } else {
        // No driver linked — return success without creating performance record
        return res.status(200).json({ success: true, data: null, message: 'Performance tracking skipped for operator' });
      }
    }

    let performance = await prisma.tripPerformance.findUnique({
      where: { booking_id: bookingId }
    });

    if (!performance) {
      performance = await prisma.tripPerformance.create({
        data: {
          booking_id: bookingId,
          driver_id: driverId,
          dot_status: 'ACTIVE'
        }
      });
    }

    const updateData = {};
    const now = new Date();

    if (milestone === 'ARRIVE') updateData.arrive_time = now;
    if (milestone === 'COLLECT') {
      updateData.collection_time = now;
      if (weight !== undefined) updateData.weight_of_load = weight;
    }
    if (milestone === 'DEPART') updateData.depart_time = now;
    if (milestone === 'DESTINATION_ARRIVE') updateData.destination_arrive_time = now;

    performance = await prisma.tripPerformance.update({
      where: { id: performance.id },
      data: updateData
    });

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const driverId = await getDriverId(req);
    
    if (!driverId) {
      return res.status(404).json({ success: false, message: 'Driver profile not found' });
    }
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Missing coordinates' });
    }
    
    const driver = await prisma.driver.findUnique({ where: { id: driverId }});
    if (!driver || driver.status === 'OFFLINE') {
      return res.status(403).json({ success: false, message: 'Location updates ignored while OFFLINE' });
    }

    await prisma.driverProfile.upsert({
      where: { driver_id: driverId },
      create: { 
        driver_id: driverId,
        gps_lat: parseFloat(latitude), 
        gps_lng: parseFloat(longitude)
      },
      update: { 
        gps_lat: parseFloat(latitude), 
        gps_lng: parseFloat(longitude)
      }
    });
    
    res.json({ success: true, message: 'Location updated successfully' });
  } catch (error) {
    console.error('[driverController] updateLocation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveBankDetails = async (req, res) => {
  try {
    const driverId = await getDriverId(req);
    const { bankName, accountNumber, accountName } = req.body;
    
    // Mock Paystack recipient creation
    const recipientCode = `RCP_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        paystack_recipient_code: recipientCode
      }
    });
    
    res.json({ success: true, message: 'Bank details saved successfully', recipientCode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAvailableLoads,
  applyForLoad,
  getActiveTrip,
  updateTripStatus,
  getDriverHistory,
  getDriverDashboard,
  submitKYC,
  getProfile,
  updateProfile,
  completeOnboarding,
  updateTelemetry,
  toggleOnlineStatus,
  getKYCDocuments,
  uploadKYCDocument,
  getPendingOffers,
  acceptOffer,
  submitCompliance,
  updatePerformance,
  rejectOffer,
  updateLocation,
  saveBankDetails
};
