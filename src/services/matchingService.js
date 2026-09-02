const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Haversine formula to calculate straight-line distance in km between two lat/lng points.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined ||
      lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) {
    return Infinity;
  }
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * SHARED ELIGIBILITY HELPER:
 * Evaluates candidate Transporters / Fleet Owners / Drivers / Vehicles strictly by ELIGIBILITY first.
 * Distance ranking is performed ONLY after eligibility filtering.
 */
async function findClosestEligibleTransporter(booking, excludedDriverIds = []) {
  const pLat = booking.pickup_coords_lat;
  const pLng = booking.pickup_coords_lng;

  if (pLat === null || pLat === undefined || pLng === null || pLng === undefined) {
    return { error: 'Pickup coordinates are missing' };
  }

  // Fetch all previously rejected LoadOffers for this booking to exclude candidates
  const rejectedOffers = await prisma.loadOffer.findMany({
    where: { booking_id: booking.id, status: 'REJECTED' }
  });
  
  const allExcludedIds = new Set([
    ...excludedDriverIds.filter(Boolean),
    ...rejectedOffers.map(o => o.driver_id).filter(Boolean)
  ]);

  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const now = new Date();

  // Step 1: Query active driver profiles with fresh GPS telemetry
  const activeProfiles = await prisma.driverProfile.findMany({
    where: {
      gps_lat: { not: null },
      gps_lng: { not: null },
      updated_at: { gte: thirtyMinsAgo },
      driver: {
        id: { notIn: Array.from(allExcludedIds) },
        status: 'AVAILABLE',
        is_deleted: false,
        user: { status: 'ACTIVE', is_deleted: false },
        fleet_owner_id: { not: null },
        fleet_owner: {
          status: { in: ['ACTIVE', 'APPROVED'] },
          is_deleted: false,
          user: { status: 'ACTIVE', is_deleted: false }
        }
      }
    },
    include: {
      driver: {
        include: {
          fleet_owner: { include: { user: true } },
          assigned_vehicle: { include: { category: true } },
          user: true,
          approval: true,
          assignments: {
            where: {
              status: { in: ['ACTIVE', 'PENDING'] },
              booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } }
            }
          }
        }
      }
    }
  });

  let candidatePool = activeProfiles.map(dp => ({
    lat: dp.gps_lat,
    lng: dp.gps_lng,
    driver: dp.driver,
    fleetOwnerId: dp.driver.fleet_owner_id,
    vehicle: dp.driver.assigned_vehicle,
    locationSource: 'GPS'
  }));

  // Step 1b: If no fresh GPS candidates found, fallback to Fleet Owner Depot locations
  if (candidatePool.length === 0) {
    const eligibleFleets = await prisma.fleetOwner.findMany({
      where: {
        status: { in: ['ACTIVE', 'APPROVED'] },
        is_deleted: false,
        location_lat: { not: null },
        location_lng: { not: null },
        user: { status: 'ACTIVE', is_deleted: false },
        drivers: {
          some: {
            id: { notIn: Array.from(allExcludedIds) },
            status: 'AVAILABLE',
            is_deleted: false,
            user: { status: 'ACTIVE', is_deleted: false }
          }
        }
      },
      include: {
        user: true,
        drivers: {
          where: {
            id: { notIn: Array.from(allExcludedIds) },
            status: 'AVAILABLE',
            is_deleted: false,
            user: { status: 'ACTIVE', is_deleted: false }
          },
          include: {
            assigned_vehicle: { include: { category: true } },
            user: true,
            approval: true,
            assignments: {
              where: {
                status: { in: ['ACTIVE', 'PENDING'] },
                booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } }
              }
            }
          }
        }
      }
    });

    for (const fleet of eligibleFleets) {
      for (const driver of fleet.drivers) {
        candidatePool.push({
          lat: fleet.location_lat,
          lng: fleet.location_lng,
          driver: driver,
          fleetOwnerId: fleet.id,
          vehicle: driver.assigned_vehicle,
          locationSource: 'DEPOT'
        });
      }
    }
  }

  if (candidatePool.length === 0) {
    return { error: 'No active transporters with valid location data found in the region' };
  }

  // Step 2: Strict Eligibility Filtering (Account, KYC, Vehicle, Compliance, Non-Conflict)
  const eligibleCandidates = candidatePool.filter(candidate => {
    const { driver, vehicle } = candidate;

    // Vehicle existence check
    if (!vehicle || vehicle.is_deleted) return false;

    // Vehicle Status check
    if (vehicle.status && !['REGISTERED', 'ACTIVE', 'AVAILABLE'].includes(vehicle.status.toUpperCase())) {
      return false;
    }

    // Vehicle Capacity check vs booking cargo weight (if specified)
    if (booking.weight > 0 && vehicle.capacity && vehicle.capacity < (booking.weight * 0.8)) {
      return false;
    }

    // Vehicle Category / Type Match (if requested_vehicle is specified and not 'Any')
    if (booking.requested_vehicle && booking.requested_vehicle.trim() !== '' && booking.requested_vehicle.toLowerCase() !== 'any') {
      const reqVeh = booking.requested_vehicle.toLowerCase();
      const vehType = (vehicle.vehicle_type || '').toLowerCase();
      const catName = (vehicle.category?.name || '').toLowerCase();
      const catId = (vehicle.category_id || '').toLowerCase();
      
      const matches = 
        vehType.includes(reqVeh) || 
        catName.includes(reqVeh) || 
        reqVeh.includes(vehType) || 
        reqVeh.includes(catName) || 
        reqVeh === catId;

      if (!matches) return false;
    }

    // Driver License Expiry check
    if (driver.license_expiry && new Date(driver.license_expiry) < now) {
      return false;
    }

    // Driver KYC / Approval Status check (if approval record exists)
    if (driver.approval && driver.approval.status === 'REJECTED') {
      return false;
    }

    // Driver Conflicting Trips check
    if (driver.assignments && driver.assignments.length > 0) {
      return false;
    }

    // Vehicle Fitness Expiry check
    if (vehicle.fitness_expiry && new Date(vehicle.fitness_expiry) < now) {
      return false;
    }

    // Vehicle Insurance Expiry check
    if (vehicle.insurance_expiry && new Date(vehicle.insurance_expiry) < now) {
      return false;
    }

    return true;
  });

  if (eligibleCandidates.length === 0) {
    return { error: 'Nearby transporters found, but none satisfy vehicle capacity, category, compliance, or availability requirements' };
  }

  // Step 3: Distance Ranking of ELIGIBLE candidates only
  let closestMatch = null;
  let minDistance = Infinity;

  for (const candidate of eligibleCandidates) {
    const dist = calculateDistance(pLat, pLng, candidate.lat, candidate.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closestMatch = candidate;
    }
  }

  if (!closestMatch || minDistance > 1000) {
    return { error: `Closest eligible transporter is too far (${Math.round(minDistance)} km)` };
  }

  // Step 4: ETA Calculation (60 km/h avg speed + 15 min handling buffer)
  const hoursToPickup = minDistance / 60;
  const estimatedPickupTime = new Date(Date.now() + (hoursToPickup * 60 + 15) * 60 * 1000);
  const estimatedDurationMins = Math.round(hoursToPickup * 60 + 15);

  return {
    success: true,
    closestMatch,
    distanceKm: parseFloat(minDistance.toFixed(2)),
    estimatedDurationMins,
    estimatedPickupTime
  };
}

/**
 * Primary Transporter Matching Function:
 * Searches for closest ELIGIBLE driver/transporter, calculates ETA,
 * updates booking to TRANSPORTER_AVAILABLE -> PAYMENT_PENDING,
 * creates a HELD load offer, and prepares Invoice for pre-payment.
 */
async function calculateETAAndPreparePayment(bookingId, excludedDriverIds = [], io = null) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { quotes: true }
    });

    if (!booking) throw new Error('Booking not found');

    const setManualAction = async (reason) => {
      console.log(`[MatchingService] ${reason}. Setting status to MANUAL_ACTION_REQUIRED.`);
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'MANUAL_ACTION_REQUIRED' }
      });
      await prisma.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'MANUAL_ACTION_REQUIRED',
          remarks: `Automated matching failed: ${reason}`,
          updated_by: 'SYSTEM'
        }
      });
      if (io) {
        io.emit(`booking_status_updated_${bookingId}`, { status: 'MANUAL_ACTION_REQUIRED', message: reason });
      }
      return { success: false, message: reason };
    };

    // Run strict eligibility and distance ranking
    const result = await findClosestEligibleTransporter(booking, excludedDriverIds);

    if (!result.success) {
      return setManualAction(result.error);
    }

    const { closestMatch, distanceKm, estimatedPickupTime } = result;
    const fleetOwnerId = closestMatch.fleetOwnerId;
    const matchedDriverId = closestMatch.driver.id;

    // Execute atomic transaction for state persistence
    await prisma.$transaction(async (tx) => {
      // 1. Update Booking -> TRANSPORTER_AVAILABLE with ETA & distance
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'TRANSPORTER_AVAILABLE',
          estimated_pickup_time: estimatedPickupTime,
          estimated_distance: distanceKm
        }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'TRANSPORTER_AVAILABLE',
          remarks: `Closest eligible transporter matched (${closestMatch.locationSource} location). Distance: ${distanceKm} km. Pickup ETA: ${estimatedPickupTime.toLocaleString()}.`,
          updated_by: 'SYSTEM'
        }
      });

      // 2. Create or Update HELD LoadOffer for this Fleet Owner
      const existingOffer = await tx.loadOffer.findFirst({
        where: { booking_id: bookingId, fleet_owner_id: fleetOwnerId }
      });

      if (existingOffer) {
        await tx.loadOffer.update({
          where: { id: existingOffer.id },
          data: {
            driver_id: matchedDriverId,
            status: 'HELD_PENDING_PAYMENT',
            distance_km: distanceKm,
            estimated_pickup_time: estimatedPickupTime
          }
        });
      } else {
        await tx.loadOffer.create({
          data: {
            booking_id: bookingId,
            fleet_owner_id: fleetOwnerId,
            driver_id: matchedDriverId,
            status: 'HELD_PENDING_PAYMENT',
            distance_km: distanceKm,
            estimated_pickup_time: estimatedPickupTime
          }
        });
      }

      // 3. Generate Draft Invoice if not present
      const existingInvoice = await tx.invoice.findFirst({ where: { booking_id: bookingId } });
      if (!existingInvoice) {
        const grandTotal = booking.quotes.length > 0 ? Number(booking.quotes[0].grand_total) : 1500;
        await tx.invoice.create({
          data: {
            invoice_no: `INV-${Math.floor(100000 + Math.random() * 900000)}`,
            booking_id: bookingId,
            customer_id: booking.customer_id,
            amount: grandTotal,
            tax_amount: 0,
            total_amount: grandTotal,
            status: 'DRAFT'
          }
        });
      }

      // 4. Move Booking -> PAYMENT_PENDING for customer checkout
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'PAYMENT_PENDING' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'PAYMENT_PENDING',
          remarks: 'Pre-payment ETA established. Booking ready for customer checkout.',
          updated_by: 'SYSTEM'
        }
      });
    });

    if (io) {
      io.emit(`booking_status_updated_${bookingId}`, {
        status: 'PAYMENT_PENDING',
        estimatedPickupTime,
        distanceKm
      });
    }

    console.log(`[MatchingService] Successfully matched closest eligible Transporter for booking ${bookingId}. Awaiting Payment.`);
    return {
      success: true,
      message: 'Eligible transporter found. Pickup ETA established. Awaiting customer payment.',
      estimatedPickupTime,
      distanceKm
    };

  } catch (error) {
    console.error('[MatchingService] Error in calculateETAAndPreparePayment:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Called when Customer completes payment. Releases HELD offer to Fleet Owner.
 */
async function dispatchLoad(bookingId, io = null) {
  try {
    const heldOffer = await prisma.loadOffer.findFirst({
      where: { booking_id: bookingId, status: 'HELD_PENDING_PAYMENT' },
      orderBy: { created_at: 'desc' }
    });

    if (!heldOffer) {
      console.warn(`[MatchingService] No HELD offer found for ${bookingId}. Possibly already dispatched.`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.update({
        where: { id: heldOffer.id },
        data: { status: 'PENDING' }
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'TRANSPORTER_ASSIGNMENT' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'TRANSPORTER_ASSIGNMENT',
          remarks: 'Payment confirmed. Load assignment dispatched to matched Fleet Owner.',
          updated_by: 'SYSTEM'
        }
      });
    });

    if (io) {
      io.emit(`load_dispatched_${heldOffer.fleet_owner_id}`, { bookingId });
      io.emit(`booking_status_updated_${bookingId}`, { status: 'TRANSPORTER_ASSIGNMENT' });
    }

    console.log(`[MatchingService] Dispatched Load ${bookingId} to Fleet Owner ${heldOffer.fleet_owner_id}.`);
  } catch (error) {
    console.error('[MatchingService] Error in dispatchLoad:', error);
  }
}

/**
 * Fallback Matching: Re-runs the exact same strict eligibility evaluation when a driver/transporter rejects.
 */
async function fallbackMatching(bookingId, rejectedDriverId, io = null) {
  try {
    console.log(`[MatchingService] Rejection occurred on booking ${bookingId} by Driver/Transporter ${rejectedDriverId}. Running fallback...`);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return;

    const setManualAction = async (reason) => {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'MANUAL_ACTION_REQUIRED' }
      });
      await prisma.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'MANUAL_ACTION_REQUIRED',
          remarks: `Automated fallback matching failed: ${reason}`,
          updated_by: 'SYSTEM'
        }
      });
      if (io) {
        io.emit(`booking_status_updated_${bookingId}`, { status: 'MANUAL_ACTION_REQUIRED', message: reason });
      }
    };

    // Fetch all historical rejected driver IDs for this booking to prevent re-offering to any rejecting driver
    const [rejectedOffers, rejectedAssignments] = await Promise.all([
      prisma.loadOffer.findMany({
        where: { booking_id: bookingId, status: 'REJECTED' },
        select: { driver_id: true }
      }),
      prisma.bookingAssignment.findMany({
        where: { booking_id: bookingId, status: 'REJECTED' },
        select: { driver_id: true }
      })
    ]);

    const excludedDriverIds = new Set([
      ...(rejectedDriverId ? [rejectedDriverId] : []),
      ...rejectedOffers.map(o => o.driver_id).filter(Boolean),
      ...rejectedAssignments.map(a => a.driver_id).filter(Boolean)
    ]);

    // Run identical eligibility calculation excluding all rejected driver IDs
    const result = await findClosestEligibleTransporter(booking, Array.from(excludedDriverIds));

    if (!result.success) {
      return setManualAction(result.error);
    }

    const { closestMatch, distanceKm, estimatedPickupTime } = result;

    // Directly dispatch to newly selected Fleet Owner (since payment was already completed)
    await prisma.$transaction(async (tx) => {
      await tx.loadOffer.create({
        data: {
          booking_id: bookingId,
          fleet_owner_id: closestMatch.fleetOwnerId,
          driver_id: closestMatch.driver.id,
          status: 'PENDING',
          distance_km: distanceKm,
          estimated_pickup_time: estimatedPickupTime
        }
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'TRANSPORTER_ASSIGNMENT',
          estimated_pickup_time: estimatedPickupTime,
          estimated_distance: distanceKm
        }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'TRANSPORTER_ASSIGNMENT',
          remarks: `Fallback successful. Dispatched assignment to next closest eligible Fleet Owner. ETA: ${estimatedPickupTime.toLocaleString()}.`,
          updated_by: 'SYSTEM'
        }
      });
    });

    if (io) {
      io.emit(`load_dispatched_${closestMatch.fleetOwnerId}`, { bookingId });
      io.emit(`booking_status_updated_${bookingId}`, { status: 'TRANSPORTER_ASSIGNMENT', estimatedPickupTime });
    }

    console.log(`[MatchingService] Fallback successfully dispatched Load ${bookingId} to Fleet Owner ${closestMatch.fleetOwnerId}.`);

  } catch (error) {
    console.error('[MatchingService] Error in fallbackMatching:', error);
  }
}

module.exports = {
  calculateETAAndPreparePayment,
  dispatchLoad,
  fallbackMatching,
  findClosestEligibleTransporter,
  calculateDistance
};


