const { prisma } = require('../config/db');
const bcrypt = require('bcrypt');
const { fallbackMatching } = require('../services/matchingService');

// Helper to get fleet owner ID STRICTLY (Auto-creates missing profile record if needed)
const getFleetOwnerId = async (req) => {
  if (!req.user || req.user.role !== 'FLEET_OWNER') {
    throw new Error('Unauthorized. Fleet Owner access required.');
  }
  let fleetOwner = await prisma.fleetOwner.findUnique({
    where: { user_id: req.user.id }
  });
  if (!fleetOwner) {
    fleetOwner = await prisma.fleetOwner.create({
      data: {
        user_id: req.user.id,
        company_name: req.user.email ? `${req.user.email.split('@')[0]} Logistics` : 'Registered Transporter',
        status: 'REGISTERED'
      }
    });
  }
  return fleetOwner.id;
};

const getDashboard = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const fleetOwner = await prisma.fleetOwner.findUnique({
      where: { id: fleetOwnerId },
      include: {
        user: true,
        vehicles: true,
        drivers: {
          include: {
            user: true,
            assigned_vehicle: true,
            compliance: true,
            status_history: {
              orderBy: { created_at: 'desc' },
              take: 5
            },
            tripPerformances: true
          }
        },
        assignments: true
      }
    });

    if (!fleetOwner) return res.status(404).json({ success: false, message: 'Fleet Owner not found' });

    // Fleet KPIs
    const totalDrivers = fleetOwner.drivers.length;
    const availableDrivers = fleetOwner.drivers.filter(d => d.status === 'AVAILABLE').length;
    const driversOnTrip = fleetOwner.drivers.filter(d => d.status === 'ON_TRIP').length;
    const inactiveDrivers = fleetOwner.drivers.filter(d => ['UNAVAILABLE', 'INACTIVE', 'SUSPENDED'].includes(d.status)).length;
    const availableVehicles = fleetOwner.vehicles.filter(v => v.status === 'AVAILABLE').length;
    
    // Compliance KPIs
    let totalUniform = 0, totalHygiene = 0, totalDocumentation = 0;
    const now = new Date();
    let expiredDocuments = 0;
    
    fleetOwner.drivers.forEach(d => {
      if (d.compliance && d.compliance.length > 0) {
        const c = d.compliance[0]; // assuming latest
        if (c.uniform_standards) totalUniform++;
        if (c.hygiene) totalHygiene++;
        if (c.documentation) totalDocumentation++;
      }
      if (d.license_expiry && new Date(d.license_expiry) < now) expiredDocuments++;
    });
    
    // Check vehicle documents
    fleetOwner.vehicles.forEach(v => {
      if (v.insurance_expiry && new Date(v.insurance_expiry) < now) expiredDocuments++;
      if (v.fitness_expiry && new Date(v.fitness_expiry) < now) expiredDocuments++;
    });

    const uniformCompliancePct = totalDrivers > 0 ? Math.round((totalUniform / totalDrivers) * 100) : 0;
    const hygieneCompliancePct = totalDrivers > 0 ? Math.round((totalHygiene / totalDrivers) * 100) : 0;
    const docCompliancePct = totalDrivers > 0 ? Math.round((totalDocumentation / totalDrivers) * 100) : 0;

    // Performance KPIs
    let totalArriveTime = 0, totalCollectionTime = 0, totalDepartTime = 0, totalDestArriveTime = 0;
    let dotCount = 0;
    let totalWeight = 0;
    let performanceRecords = 0;

    fleetOwner.drivers.forEach(d => {
      if (d.tripPerformances && d.tripPerformances.length > 0) {
        d.tripPerformances.forEach(p => {
          performanceRecords++;
          if (p.dot_status === 'ON_TIME') dotCount++;
          if (p.weight_of_load) totalWeight += parseFloat(p.weight_of_load);
          
          // In a real scenario, average times would be calculated from transit durations
          // For now we will return 0 if there are no complex dates diff logic implemented
        });
      }
    });
    
    const dotPct = performanceRecords > 0 ? Math.round((dotCount / performanceRecords) * 100) : 0;
    const averageWeight = performanceRecords > 0 ? (totalWeight / performanceRecords).toFixed(2) : 0;

    // Availability History
    let availabilityHistory = [];
    fleetOwner.drivers.forEach(d => {
      if (d.status_history) {
        d.status_history.forEach(h => {
          if (h.new_status === 'UNAVAILABLE' || h.new_status === 'FALSE' || h.new_status === 'INACTIVE') {
            availabilityHistory.push({
              id: h.id,
              driverName: `${d.user?.first_name || ''} ${d.user?.last_name || ''}`,
              driverId: d.id,
              oldStatus: h.old_status,
              newStatus: h.new_status,
              trigger: h.change_reason || 'Manual Update',
              timestamp: h.created_at
            });
          }
        });
      }
    });
    
    // Sort availability history by latest
    availabilityHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({
      success: true,
      data: fleetOwner,
      stats: {
        fleet: {
          totalDrivers,
          availableDrivers,
          driversOnTrip,
          inactiveDrivers,
          availableVehicles,
        },
        compliance: {
          uniformCompliancePct,
          hygieneCompliancePct,
          docCompliancePct,
          expiredDocuments
        },
        performance: {
          dotPct,
          averageWeight,
          totalWeight
        },
        availabilityHistory: availabilityHistory.slice(0, 10)
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitCompliance = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { company_documents } = req.body;

    const fleetOwner = await prisma.fleetOwner.update({
      where: { id: fleetOwnerId },
      data: {
        status: 'UNDER_REVIEW',
        company_documents: typeof company_documents === 'object' ? JSON.stringify(company_documents) : company_documents
      }
    });

    res.status(200).json({
      success: true,
      message: 'Compliance documents submitted successfully. Account is now under review.',
      data: fleetOwner
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const addVehicle = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const {
      registration_number, vehicle_type, capacity,
      photo_url, brand, model, year, vin,
      insurance_expiry, fitness_expiry,
      insurance_document, registration_document, fitness_document,
      category_id
    } = req.body;

    // category_id is optional — try to resolve one if not provided, but don't block
    let finalCategoryId = category_id || null;
    if (!finalCategoryId) {
      const category = await prisma.vehicleCategory.findFirst();
      if (category) finalCategoryId = category.id;
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        fleet_owner_id: fleetOwnerId,
        category_id: finalCategoryId,          // nullable — no categories is fine
        registration_number,
        vehicle_type,
        capacity: capacity ? parseFloat(capacity) : null,
        status: 'REGISTERED', // Functions as pending review
        photo_url: photo_url || null,
        brand: brand || null,
        model: model || null,
        year: year ? parseInt(year) : null,
        vin: vin || null,
        insurance_expiry: insurance_expiry ? new Date(insurance_expiry) : null,
        fitness_expiry: fitness_expiry ? new Date(fitness_expiry) : null,
        insurance_document: insurance_document || null,
        registration_document: registration_document || null,
        fitness_document: fitness_document || null,
      }
    });

    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    if (error.code === 'P2002') {
      if (error.meta?.target?.includes('registration_number')) {
        return res.status(409).json({ success: false, message: 'A vehicle with this registration number already exists.' });
      }
      return res.status(409).json({ success: false, message: 'A record with this information already exists.' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const getVehicles = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const vehicles = await prisma.vehicle.findMany({
      where: { fleet_owner_id: fleetOwnerId, is_deleted: false },
      include: {
        assigned_drivers: { include: { user: true } },
        assignments: {
          where: {
            status: { in: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'IN_TRANSIT', 'ARRIVED_PICKUP', 'LOADING'] }
          },
          take: 1,
          include: { booking: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: vehicles });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateVehicle = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;
    const {
      registration_number, vehicle_type, capacity,
      photo_url, brand, model, year, vin,
      insurance_expiry, fitness_expiry,
      insurance_document, registration_document, fitness_document
    } = req.body;

    // Verify ownership
    const existing = await prisma.vehicle.findFirst({ where: { id, fleet_owner_id: fleetOwnerId, is_deleted: false } });
    if (!existing) throw new Error('Vehicle not found');

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        registration_number,
        vehicle_type,
        capacity: capacity ? parseFloat(capacity) : null,
        photo_url: photo_url !== undefined ? photo_url : existing.photo_url,
        brand: brand || null,
        model: model || null,
        year: year ? parseInt(year) : null,
        vin: vin || null,
        insurance_expiry: insurance_expiry ? new Date(insurance_expiry) : null,
        fitness_expiry: fitness_expiry ? new Date(fitness_expiry) : null,
        insurance_document: insurance_document || null,
        registration_document: registration_document || null,
        fitness_document: fitness_document || null,
      }
    });

    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    if (error.code === 'P2002') {
      if (error.meta?.target?.includes('registration_number')) {
        return res.status(409).json({ success: false, message: 'A vehicle with this registration number already exists.' });
      }
      return res.status(409).json({ success: false, message: 'A record with this information already exists.' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId, is_deleted: false },
      include: {
        assignments: {
          where: { status: { in: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'IN_TRANSIT', 'ARRIVED_PICKUP', 'LOADING'] } }
        }
      }
    });

    if (!vehicle) throw new Error('Vehicle not found');
    if (vehicle.assignments.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete: vehicle has an active booking assignment.' });
    }

    // Soft delete
    await prisma.vehicle.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() }
    });

    res.status(200).json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


const getDrivers = async (req, res) => {
  try {
    // Authorization check — return 403 not 400 for wrong role
    if (!req.user || req.user.role !== 'FLEET_OWNER') {
      return res.status(403).json({ success: false, message: 'Fleet Owner access required.' });
    }
    const fleetOwner = await prisma.fleetOwner.findUnique({
      where: { user_id: req.user.id }
    });
    if (!fleetOwner) {
      return res.status(403).json({ success: false, message: 'Fleet Owner profile not found.' });
    }

    const drivers = await prisma.driver.findMany({
      where: { fleet_owner_id: fleetOwner.id, is_deleted: false },
      include: {
        user: true,
        assigned_vehicle: true
      }
    });
    res.status(200).json({ success: true, data: drivers });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const addDriver = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { first_name, last_name, email, phone, password, license, license_expiry, driving_category, national_id, address, base_lat, base_lng, emergency_contact, documents, status, avatar, assigned_vehicle_id } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new Error('Email is already registered');

    const hashedPassword = await bcrypt.hash(password, 10);

    if (assigned_vehicle_id) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: assigned_vehicle_id, fleet_owner_id: fleetOwnerId }
      });
      if (!vehicle) throw new Error('Selected vehicle is not available or does not belong to your fleet');
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'DRIVER',
          status: 'ACTIVE',
          first_name,
          last_name,
          phone,
          avatar: avatar || documents?.photo || null
        }
      });

      const driver = await tx.driver.create({
        data: {
          user_id: user.id,
          fleet_owner_id: fleetOwnerId,
          license,
          license_expiry: license_expiry ? new Date(license_expiry) : null,
          driving_category,
          national_id,
          address,
          emergency_contact: typeof emergency_contact === 'object' && emergency_contact !== null ? JSON.stringify(emergency_contact) : emergency_contact || null,
          documents: typeof documents === 'object' && documents !== null ? JSON.stringify(documents) : documents || null,
          assigned_vehicle_id: assigned_vehicle_id || null,
          status: 'ACTIVE'
        }
      });
      
      await tx.driverApproval.create({
        data: {
          driver_id: driver.id,
          status: 'APPROVED'
        }
      });
      
      await tx.driverProfile.create({
        data: {
          driver_id: driver.id,
          address: address,
          base_address: address,
          base_lat: base_lat !== undefined ? base_lat : null,
          base_lng: base_lng !== undefined ? base_lng : null
        }
      });
      
      if (documents && (documents.govt_id || documents.license_front || documents.license_back)) {
        await tx.driverDocuments.create({
          data: {
            driver_id: driver.id,
            govt_id: documents.govt_id || null,
            license_front: documents.license_front || null,
            license_back: documents.license_back || null
          }
        });
      }
      
      return driver;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateDriver = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;
    const { first_name, last_name, email, phone, license, license_expiry, driving_category, national_id, address, base_lat, base_lng, status, avatar, assigned_vehicle_id } = req.body;

    const driver = await prisma.driver.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId }
    });

    if (!driver) throw new Error('Driver not found');

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: { email, NOT: { id: driver.user_id } }
      });
      if (existingUser) throw new Error('Email is already in use');
    }

    if (assigned_vehicle_id !== undefined && assigned_vehicle_id !== driver.assigned_vehicle_id) {
      if (driver.status === 'ON_TRIP') {
        throw new Error('Vehicle cannot be changed while the driver is on an active trip.');
      }
      
      if (assigned_vehicle_id !== null) {
        const vehicle = await prisma.vehicle.findFirst({
          where: { id: assigned_vehicle_id, fleet_owner_id: fleetOwnerId }
        });
        if (!vehicle) throw new Error('Selected vehicle is not available or does not belong to your fleet');
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: driver.user_id },
        data: {
          first_name,
          last_name,
          email,
          phone,
          avatar: avatar !== undefined ? avatar : undefined,
          status: status
        }
      });

      const updatedDriver = await tx.driver.update({
        where: { id: driver.id },
        data: {
          license,
          license_expiry: license_expiry ? new Date(license_expiry) : null,
          driving_category,
          national_id,
          address,
          assigned_vehicle_id: assigned_vehicle_id !== undefined ? assigned_vehicle_id : undefined
        }
      });

      if (base_lat !== undefined || base_lng !== undefined) {
        await tx.driverProfile.upsert({
          where: { driver_id: driver.id },
          create: {
            driver_id: driver.id,
            address: address,
            base_address: address,
            base_lat: base_lat !== undefined ? base_lat : null,
            base_lng: base_lng !== undefined ? base_lng : null
          },
          update: {
            address: address !== undefined ? address : undefined,
            base_address: address !== undefined ? address : undefined,
            base_lat: base_lat !== undefined ? base_lat : undefined,
            base_lng: base_lng !== undefined ? base_lng : undefined
          }
        });
      }

      return updatedDriver;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateDriverStatus = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;
    const { status } = req.body;

    const driver = await prisma.driver.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId },
      include: { user: true }
    });

    if (!driver) throw new Error('Driver not found');

    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: driver.user_id },
        data: { status }
      });

      let driverStatus = driver.status;
      if (status === 'ACTIVE' && driver.status === 'INACTIVE') {
        driverStatus = 'AVAILABLE';
      } else if (status === 'SUSPENDED') {
        driverStatus = 'INACTIVE';
      }

      if (driverStatus !== driver.status) {
        await tx.driver.update({
          where: { id },
          data: { status: driverStatus }
        });
      }

      return updatedUser;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteDriver = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;

    const driver = await prisma.driver.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId },
      include: { assignments: true }
    });

    if (!driver) throw new Error('Driver not found');

    const activeAssignment = driver.assignments.find(a => ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'LOADING', 'IN_TRANSIT'].includes(a.status));
    if (activeAssignment) {
      return res.status(400).json({ success: false, message: 'This driver cannot be deleted because an active booking is assigned.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.driver.delete({ where: { id: driver.id } });
      await tx.user.delete({ where: { id: driver.user_id } });
    });

    res.status(200).json({ success: true, message: 'Driver deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLoads = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);

    const assignments = await prisma.bookingAssignment.findMany({
      where: { fleet_owner_id: fleetOwnerId },
      include: {
        booking: {
          include: { customer: { include: { user: true } } }
        },
        driver: { include: { user: true } },
        vehicle: true
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ success: true, data: assignments });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const acceptAndDispatch = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params;
    const { driverId, vehicleId } = req.body;

    const assignment = await prisma.bookingAssignment.findFirst({
      where: { booking_id: id, fleet_owner_id: fleetOwnerId }
    });

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Load assignment not found for this fleet owner.' });
    }

    const driver = await prisma.driver.findFirst({
      where: { id: driverId, fleet_owner_id: fleetOwnerId }
    });
    if (!driver) return res.status(400).json({ success: false, message: 'Selected driver does not belong to your fleet.' });

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, fleet_owner_id: fleetOwnerId }
    });
    if (!vehicle) return res.status(400).json({ success: false, message: 'Selected vehicle does not belong to your fleet.' });

    await prisma.$transaction(async (tx) => {
      await tx.bookingAssignment.update({
        where: { id: assignment.id },
        data: {
          driver_id: driverId,
          vehicle_id: vehicleId,
          status: 'ACTIVE'
        }
      });

      await tx.booking.update({
        where: { id },
        data: { status: 'DRIVER_ASSIGNED' }
      });

      await tx.driver.update({
        where: { id: driverId },
        data: { status: 'ON_TRIP' }
      });

      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: 'ON_TRIP' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: 'DRIVER_ASSIGNED',
          remarks: 'Fleet Owner accepted load and dispatched vehicle + driver.',
          updated_by: req.user.id
        }
      });
    });

    res.status(200).json({ success: true, message: 'Load dispatched successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPendingOffers = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const offers = await prisma.loadOffer.findMany({
      where: { 
        fleet_owner_id: fleetOwnerId, 
        status: 'PENDING',
        // Only show fleet-level offers (booking awaiting Fleet Owner action).
        // Exclude driver-level PENDING offers (those are for the Driver portal).
        booking: {
          status: 'TRANSPORTER_ASSIGNMENT',
          is_deleted: false
        }
      },
      include: {
        booking: {
          include: { 
            customer: { include: { user: true } }, 
            quotes: true,
            settlement: true
          }
        },
        driver: {
          include: { user: true, profile: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: offers });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const acceptLoadOffer = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params; // LoadOffer ID
    const { driverId, vehicleId } = req.body;

    if (!driverId || !vehicleId) {
      return res.status(400).json({ success: false, message: 'Driver and Vehicle must be assigned.' });
    }

    const offer = await prisma.loadOffer.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId, status: 'PENDING' },
      include: { booking: true }
    });

    if (!offer) return res.status(404).json({ success: false, message: 'Offer not found or already processed' });

    const driver = await prisma.driver.findFirst({
      where: { id: driverId, fleet_owner_id: fleetOwnerId },
      include: { user: true }
    });
    if (!driver) return res.status(400).json({ success: false, message: 'Selected driver does not belong to your fleet.' });
    if (driver.status !== 'AVAILABLE') return res.status(400).json({ success: false, message: 'Selected driver is not currently available.' });
    // Note: is_online is not a DB field. status === 'AVAILABLE' already means the driver toggled online.
    if (driver.user?.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Selected driver account is not active.' });

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, fleet_owner_id: fleetOwnerId }
    });
    if (!vehicle) return res.status(400).json({ success: false, message: 'Selected vehicle does not belong to your fleet.' });
    if (vehicle.status !== 'AVAILABLE') return res.status(400).json({ success: false, message: 'Selected vehicle is not available.' });
    if (vehicle.capacity && vehicle.capacity < offer.booking.weight) {
      return res.status(400).json({ success: false, message: `Vehicle capacity (${vehicle.capacity}T) is insufficient for this booking (${offer.booking.weight}T).` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Accept the offer for the Fleet
      await tx.loadOffer.update({
        where: { id },
        data: { status: 'ACCEPTED_BY_FLEET' }
      });

      // 2. Reject other offers for this booking
      await tx.loadOffer.updateMany({
        where: { booking_id: offer.booking_id, id: { not: id } },
        data: { status: 'REJECTED_OTHER' }
      });

      // 3. Update driver's assigned vehicle so they use what the fleet owner selected
      await tx.driver.update({
        where: { id: driverId },
        data: { assigned_vehicle_id: vehicleId }
      });

      // 4. Create a new LoadOffer for the specific driver to Accept/Reject
      await tx.loadOffer.create({
        data: {
          booking_id: offer.booking_id,
          fleet_owner_id: fleetOwnerId,
          driver_id: driverId,
          status: 'PENDING',
          distance_km: offer.distance_km,
          estimated_pickup_time: offer.estimated_pickup_time
        }
      });

      // 5. Update booking status
      const b = await tx.booking.update({
        where: { id: offer.booking_id },
        data: { status: 'DRIVER_OFFER_SENT' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: offer.booking_id,
          status: 'DRIVER_OFFER_SENT',
          remarks: 'Fleet Owner accepted load and sent offer to specific driver.',
          updated_by: req.user.id
        }
      });

      return b;
    });

    const io = req.app ? req.app.get('io') : null;
    if (io) {
      io.emit(`driver_load_offered_${driverId}`, { bookingId: offer.booking_id });
      io.emit(`booking_status_updated_${offer.booking_id}`, { status: 'DRIVER_OFFER_SENT' });
    }

    res.status(200).json({ success: true, message: 'Load accepted and dispatched successfully.', data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const fleetOwner = await prisma.fleetOwner.findUnique({
      where: { id: fleetOwnerId },
      include: { user: true }
    });

    if (!fleetOwner) return res.status(404).json({ success: false, message: 'Profile not found' });

    res.status(200).json({
      success: true,
      data: {
        first_name: fleetOwner.user.first_name || '',
        last_name: fleetOwner.user.last_name || '',
        email: fleetOwner.user.email,
        phone: fleetOwner.user.phone || '',
        avatar: fleetOwner.user.avatar || '',
        company_name: fleetOwner.company_name || '',
        company_registration: '',
        tax_number: fleetOwner.vat_number || '',
        address: fleetOwner.address || '',
        location_lat: fleetOwner.location_lat,
        location_lng: fleetOwner.location_lng
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { first_name, last_name, phone, company_name, tax_number, address, avatar, location_lat, location_lng } = req.body;

    const fleetOwner = await prisma.fleetOwner.findUnique({
      where: { id: fleetOwnerId }
    });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: fleetOwner.user_id },
        data: {
          first_name: first_name !== undefined ? first_name : undefined,
          last_name: last_name !== undefined ? last_name : undefined,
          phone: phone !== undefined ? phone : undefined,
          avatar: avatar !== undefined ? avatar : undefined,
        }
      });

      await tx.fleetOwner.update({
        where: { id: fleetOwnerId },
        data: {
          company_name: company_name !== undefined ? company_name : undefined,
          vat_number: tax_number !== undefined ? tax_number : undefined,
          address: address !== undefined ? address : undefined,
          location_lat: location_lat !== undefined ? location_lat : undefined,
          location_lng: location_lng !== undefined ? location_lng : undefined,
        }
      });
    });

    res.status(200).json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectLoadOffer = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { id } = req.params; // LoadOffer ID
    const { rejection_reason } = req.body;

    const offer = await prisma.loadOffer.findFirst({
      where: { id, fleet_owner_id: fleetOwnerId, status: 'PENDING' }
    });

    if (!offer) return res.status(404).json({ success: false, message: 'Offer not found or already processed' });

    await prisma.$transaction(async (tx) => {
      // 1. Reject the offer
      await tx.loadOffer.update({
        where: { id },
        data: { 
          status: 'REJECTED',
          rejection_reason: rejection_reason || 'Rejected by Fleet Owner'
        }
      });

      // 2. Update booking status back to LOOKING_FOR_TRANSPORTER
      await tx.booking.update({
        where: { id: offer.booking_id },
        data: { status: 'LOOKING_FOR_TRANSPORTER' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: offer.booking_id,
          status: 'LOOKING_FOR_TRANSPORTER',
          remarks: `Fleet Owner rejected load. Reason: ${rejection_reason || 'None'}. Searching for alternative transporters.`,
          updated_by: req.user.id
        }
      });
    });

    // 3. Trigger fallback matching
    fallbackMatching(offer.booking_id, [offer.driver_id]);

    res.status(200).json({ success: true, message: 'Offer rejected successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveBankDetails = async (req, res) => {
  try {
    const fleetOwnerId = await getFleetOwnerId(req);
    const { bankName, accountNumber, accountName } = req.body;
    
    // Mock Paystack recipient creation
    const recipientCode = `RCP_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    
    await prisma.fleetOwner.update({
      where: { id: fleetOwnerId },
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
  getDashboard,
  submitCompliance,
  addVehicle,
  getVehicles,
  updateVehicle,
  deleteVehicle,
  getDrivers,
  addDriver,
  updateDriver,
  updateDriverStatus,
  deleteDriver,
  getLoads,
  acceptAndDispatch,
  getProfile,
  updateProfile,
  getPendingOffers,
  acceptLoadOffer,
  rejectLoadOffer,
  saveBankDetails
};
