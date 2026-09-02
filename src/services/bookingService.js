const { prisma } = require('../config/db');
const { calculateDetailedQuote } = require('./pricingService');

/**
 * POST /api/v1/bookings
 * Creates a new booking request with an INSTANT AUTOMATED QUOTE (status QUOTE_PREPARED).
 * Uses pricingService.calculateDetailedQuote() to eliminate manual office quotation bottlenecks.
 */
const createBooking = async (req, res, next) => {
  try {
    const {
      guest_email, guest_phone, guest_company,
      cargo_name, cargo_category, description, weight, volume, quantity,
      pickup_address, pickup_coords_lat, pickup_coords_lng, pickup_date,
      pickup_contact, pickup_instructions,
      delivery_address, delivery_coords_lat, delivery_coords_lng, delivery_date,
      delivery_contact, delivery_instructions,
      requested_vehicle, estimated_distance, estimated_duration_mins,
      requirements,
      is_urgent,
      loading_assistance,
      unloading_assistance,
      night_pickup,
    } = req.body;

    if (!pickup_address || !delivery_address) {
      return res.status(400).json({ success: false, message: 'Pickup and delivery addresses are required.' });
    }

    // Get customer_id from authenticated user
    let customer_id = req.user?.customer?.id;
    if (!customer_id && req.user?.id) {
      const customer = await prisma.customer.findUnique({
        where: { user_id: req.user.id }
      });
      customer_id = customer?.id;
    }

    // Sanitise numeric inputs
    const lat1 = pickup_coords_lat ? parseFloat(pickup_coords_lat) : null;
    const lon1 = pickup_coords_lng ? parseFloat(pickup_coords_lng) : null;
    const lat2 = delivery_coords_lat ? parseFloat(delivery_coords_lat) : null;
    const lon2 = delivery_coords_lng ? parseFloat(delivery_coords_lng) : null;

    let distanceKm = estimated_distance ? parseFloat(estimated_distance) : null;
    let durationMins = estimated_duration_mins ? parseFloat(estimated_duration_mins) : null;
    let routePolylineStr = null;

    if (lat1 && lon1 && lat2 && lon2) {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          distanceKm = parseFloat((route.distance / 1000).toFixed(2));
          durationMins = parseFloat((route.duration / 60).toFixed(1));

          const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
          routePolylineStr = JSON.stringify(coords);
        }
      } catch (err) {
        console.error('Backend OSRM Route Calculation Error:', err.message);
      }
    }

    // Fallback straight-line distance calculation if OSRM is unavailable
    if ((!distanceKm || distanceKm <= 0) && lat1 && lon1 && lat2 && lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distanceKm = parseFloat((R * c).toFixed(2));
    }

    const validDistanceKm = distanceKm && distanceKm > 0 ? distanceKm : 15;

    // Fetch dynamic admin pricing rate configurations from system_settings and VehicleCategory DB table
    let ratesConfig = {};
    let validWeight = 1.0;
    try {
      const dbSettings = await prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'RATE_LIGHT_DUTY', 'RATE_MEDIUM_DUTY', 'RATE_HEAVY_DUTY', 'RATE_REFRIGERATED',
              'RATE_WEIGHT_PER_TON', 'RATE_FUEL_SURCHARGE_PCT', 'RATE_TOLL_PER_100KM', 'RATE_VAT_PCT'
            ]
          }
        }
      });
      const sMap = {};
      dbSettings.forEach(s => { sMap[s.key] = parseFloat(s.value); });
      
      const reqVeh = requested_vehicle || 'Medium Duty';
      let perKm = null;
      let internalCapacityTons = 1.0;

      // Primary source of truth: Admin-configured VehicleCategory DB record
      if (reqVeh) {
        const cat = await prisma.vehicleCategory.findFirst({
          where: {
            OR: [
              { name: reqVeh },
              { id: reqVeh }
            ],
            is_deleted: false
          }
        });
        if (cat) {
          perKm = Number(cat.base_price_per_km);
          internalCapacityTons = cat.capacity_tons || 1.0;
        }
      }

      // Fallback matching if VehicleCategory was not found by exact string
      if (!perKm || isNaN(perKm)) {
        perKm = sMap.RATE_MEDIUM_DUTY || 18;
        if (reqVeh.includes('Light') || reqVeh.includes('Bakkie') || reqVeh.includes('Motorbike')) perKm = sMap.RATE_LIGHT_DUTY || 12;
        else if (reqVeh.includes('Heavy') || reqVeh.includes('Tipper') || reqVeh.includes('Flatbed')) perKm = sMap.RATE_HEAVY_DUTY || 30;
        else if (reqVeh.includes('Refrigerated') || reqVeh.includes('Coldroom')) perKm = sMap.RATE_REFRIGERATED || 25;
      }

      validWeight = weight ? parseFloat(weight) : internalCapacityTons;

      ratesConfig = {
        perKmRate: perKm,
        weightRate: 0,
        fuelPct: sMap.RATE_FUEL_SURCHARGE_PCT ?? 10,
        tollRate: sMap.RATE_TOLL_PER_100KM ?? 50,
        vatPct: sMap.RATE_VAT_PCT ?? 15
      };
    } catch (e) {
      validWeight = weight ? parseFloat(weight) : 1.0;
    }

    // Automatically calculate quote using authoritative pricing engine
    const quoteCalculation = calculateDetailedQuote(
      validDistanceKm,
      validWeight,
      requested_vehicle || 'Medium Duty',
      requirementTags,
      ratesConfig
    );
    const breakdown = quoteCalculation.breakdown;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the booking record with status QUOTE_PREPARED
      const booking = await tx.booking.create({
        data: {
          customer_id: customer_id || null,
          guest_email: guest_email || null,
          guest_phone: guest_phone || null,
          guest_company: guest_company || null,
          cargo_name: cargo_name || 'General Cargo',
          cargo_category: cargo_category || 'GENERAL',
          description: description || null,
          weight: validWeight,
          volume: volume ? parseFloat(volume) : null,
          quantity: quantity ? parseInt(quantity) : null,
          pickup_address,
          pickup_coords_lat: lat1,
          pickup_coords_lng: lon1,
          pickup_date: pickup_date ? new Date(pickup_date) : new Date(),
          pickup_contact: pickup_contact || null,
          pickup_instructions: pickup_instructions || null,
          delivery_address,
          delivery_coords_lat: lat2,
          delivery_coords_lng: lon2,
          delivery_date: delivery_date ? new Date(delivery_date) : new Date(Date.now() + 86400000),
          delivery_contact: delivery_contact || null,
          delivery_instructions: delivery_instructions || null,
          requested_vehicle: requested_vehicle || null,
          estimated_distance: validDistanceKm,
          estimated_duration: durationMins,
          route_polyline: routePolylineStr,
          status: 'QUOTE_PREPARED',
        }
      });

      // 2. Automatically create the Quote record inside transaction
      const quote = await tx.quote.create({
        data: {
          booking_id: booking.id,
          vehicle_rate: breakdown.base_fare,
          distance_cost: breakdown.base_fare,
          weight_charges: breakdown.weight_charges,
          fuel_charges: breakdown.fuel_surcharge,
          insurance_charges: breakdown.insurance,
          hazard_charge: breakdown.toll_charges || 0,
          platform_fee: breakdown.platform_fee,
          broker_fee: 0.00,
          tax: breakdown.tax,
          discount: breakdown.discount || 0,
          grand_total: breakdown.grand_total,
          status: 'ISSUED',
          prepared_by: 'SYSTEM'
        }
      });

      // 3. Store requirement tags
      if (requirementTags.length > 0) {
        await tx.bookingRequirement.createMany({
          data: requirementTags.map(tag => ({
            booking_id: booking.id,
            tag,
          }))
        });
      }

      // 4. Tracking history entry
      await tx.trackingHistory.create({
        data: {
          booking_id: booking.id,
          status: 'QUOTE_PREPARED',
          remarks: `Automated quotation prepared by system. Route: ${pickup_address} → ${delivery_address}. Total: R ${breakdown.grand_total.toFixed(2)}`,
          updated_by: req.user ? req.user.id : 'SYSTEM',
        }
      });

      // 5. Activity log
      await tx.activityLog.create({
        data: {
          user_id: req.user ? req.user.id : null,
          action: 'BOOKING_CREATED_AUTO_QUOTE',
          description: `Booking ${booking.id} created with automated quotation ${quote.id}. Total: R ${breakdown.grand_total.toFixed(2)}`,
        }
      });

      return {
        ...booking,
        quotes: [quote],
        quote
      };
    });

    res.status(201).json({
      success: true,
      message: 'Booking request created successfully with instant quotation.',
      data: result,
    });
  } catch (error) {
    console.error('Error in createBooking:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { createBooking };
