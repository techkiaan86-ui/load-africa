const { prisma } = require('../config/db');

const approveDriverKYC = async (req, res) => {
  try {
    const { driverId } = req.params;

    // Typically this would be protected by admin auth middleware.
    
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        status: 'ACTIVE' // Approved and Active in the marketplace
      }
    });

    res.status(200).json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveFleetOwner = async (req, res) => {
  try {
    const { fleetId } = req.params;
    const fleetOwner = await prisma.fleetOwner.update({
      where: { id: fleetId },
      data: { status: 'ACTIVE' }
    });
    res.status(200).json({ success: true, data: fleetOwner });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveVehicle = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const vehicle = await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: 'AVAILABLE' } // Approved and ready
    });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approvePlantOwner = async (req, res) => {
  try {
    const { plantId } = req.params;
    const plantOwner = await prisma.plantOwner.update({
      where: { id: plantId },
      data: { status: 'ACTIVE' }
    });
    await prisma.auditLog.create({
      data: { entity_type: 'PlantOwner', entity_id: plantId, action: 'APPROVED', new_value: 'ACTIVE' }
    });
    res.status(200).json({ success: true, data: plantOwner });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await prisma.machine.update({
      where: { id: machineId },
      data: { status: 'APPROVED' }
    });
    await prisma.auditLog.create({
      data: { entity_type: 'Machine', entity_id: machineId, action: 'APPROVED', new_value: 'APPROVED' }
    });
    res.status(200).json({ success: true, data: machine });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPendingUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'PENDING', is_deleted: false },
      include: {
        driver: true,
        fleet_owner: true,
        plant_owner: true,
        broker: true
      },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' }
      });

      if (user.role === 'DRIVER') {
        await tx.driver.update({ where: { user_id: userId }, data: { status: 'ACTIVE' }});
      } else if (user.role === 'FLEET_OWNER') {
        await tx.fleetOwner.update({ where: { user_id: userId }, data: { status: 'ACTIVE' }});
      } else if (user.role === 'PLANT_OWNER') {
        await tx.plantOwner.upsert({
          where: { user_id: userId },
          update: { status: 'ACTIVE' },
          create: {
            user_id: userId,
            company_name: `${user.first_name || 'Plant'} ${user.last_name || 'Owner'}`,
            status: 'ACTIVE'
          }
        });
      }

      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'USER_APPROVED',
          description: `Admin approved user ${user.email}`
        }
      });
    });

    res.status(200).json({ success: true, message: 'User approved successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'REJECTED' }
      });

      if (user.role === 'DRIVER') {
        await tx.driver.update({ where: { user_id: userId }, data: { status: 'REJECTED' }});
      } else if (user.role === 'FLEET_OWNER') {
        await tx.fleetOwner.update({ where: { user_id: userId }, data: { status: 'REJECTED' }});
      } else if (user.role === 'PLANT_OWNER') {
        await tx.plantOwner.update({ where: { user_id: userId }, data: { status: 'REJECTED' }});
      }

      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'USER_REJECTED',
          description: `Admin rejected user ${user.email}`
        }
      });
    });

    res.status(200).json({ success: true, message: 'User rejected successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { is_deleted: false },
      include: {
        customer: true,
        driver: true,
        fleet_owner: true,
        plant_owner: true,
        broker: true
      },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const customersCount = await prisma.user.count({ where: { role: 'CUSTOMER', is_deleted: false } });
    const driversCount = await prisma.user.count({ where: { role: 'DRIVER', is_deleted: false } });
    const fleetCount = await prisma.user.count({ where: { role: 'FLEET_OWNER', is_deleted: false } });
    const plantCount = await prisma.user.count({ where: { role: 'PLANT_OWNER', is_deleted: false } });
    const pendingUsersCount = await prisma.user.count({ where: { status: 'PENDING', is_deleted: false } });
    
    // Safety check for plantOwnerApplication
    let pendingPlantAppsCount = 0;
    if (prisma.plantOwnerApplication) {
      pendingPlantAppsCount = await prisma.plantOwnerApplication.count({ where: { status: 'PENDING' } });
    }
    const pendingCount = pendingUsersCount + pendingPlantAppsCount;
    
    // For today\'s bookings:
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayBookingsCount = await prisma.booking.count({ 
      where: { created_at: { gte: startOfDay }, is_deleted: false } 
    });

    const activeTripsCount = await prisma.booking.count({ 
      where: { 
        status: { in: ['IN_TRANSIT', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'PICKED_UP', 'LOADING'] },
        is_deleted: false 
      } 
    });

    const transportersSearchingCount = await prisma.booking.count({
      where: { status: 'DRIVER_SEARCHING', is_deleted: false }
    });

    const driversAvailableCount = await prisma.driver.count({
      where: { status: 'AVAILABLE', is_deleted: false }
    });

    const manualAssignmentsRequiredCount = await prisma.booking.count({
      where: { status: 'FAILED', is_deleted: false }
    });

    // Group bookings by status to provide the lifecycle overview
    const bookingStatusGroups = await prisma.booking.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
      where: { is_deleted: false }
    });
    
    const lifecycle = {
      QUOTE_REQUESTED: 0,
      QUOTE_PREPARED: 0,
      CUSTOMER_ACCEPTED: 0,
      DRIVER_SEARCHING: 0,
      DRIVER_OFFER_SENT: 0,
      PAYMENT_PENDING: 0,
      IN_TRANSIT: 0,
      DELIVERED: 0,
      COMPLETED: 0
    };

    bookingStatusGroups.forEach(group => {
      if (lifecycle[group.status] !== undefined) {
        lifecycle[group.status] = group._count.id;
      }
    });

    // Mock revenue for now
    const revenueSummary = 'R 0'; 

    res.status(200).json({
      success: true,
      data: {
        customers: customersCount,
        drivers: driversCount,
        fleetAccounts: fleetCount,
        plantOwners: plantCount,
        pendingApprovals: pendingCount,
        todayBookings: todayBookingsCount,
        activeTrips: activeTripsCount,
        transportersSearching: transportersSearchingCount,
        driversAvailable: driversAvailableCount,
        manualAssignmentsRequired: manualAssignmentsRequiredCount,
        revenueSummary,
        bookingLifecycle: lifecycle
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getUsersByRole = async (req, res) => {
  try {
    const { role, page = 1, limit = 10, search = '', status } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query conditions
    const whereCondition = {
      is_deleted: false
    };

    if (role) {
      const roles = role.split(',').map(r => r.toUpperCase());
      if (roles.length > 1) {
        whereCondition.role = { in: roles };
      } else {
        whereCondition.role = roles[0];
      }
    }

    if (status) {
      whereCondition.status = status.toUpperCase();
    }

    if (search) {
      whereCondition.OR = [
        { email: { contains: search } },
        { first_name: { contains: search } },
        { last_name: { contains: search } },
        { phone: { contains: search } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereCondition,
        skip,
        take: limitNum,
        include: {
          customer: true,
          driver: {
            include: {
              fleet_owner: true,
              profile: true,
              photos: true,
              documents_relation: true,
              vehicle_relation: true,
              kyc: true,
              approval: true,
              status_history: true
            }
          },
          fleet_owner: true,
          plant_owner: true,
          broker: true,
          admin: true,
          wallets: true
        },
        orderBy: { created_at: 'desc' }
      }),
      prisma.user.count({ where: whereCondition })
    ]);

    let stats = null;
    if (role && role.toUpperCase().includes('DRIVER')) {
      const [allCount, pendingCount, activeCount, rejectedCount, suspendedCount] = await Promise.all([
        prisma.user.count({ where: { role: 'DRIVER', is_deleted: false } }),
        prisma.user.count({ where: { role: 'DRIVER', status: 'PENDING', is_deleted: false } }),
        prisma.user.count({ where: { role: 'DRIVER', status: 'ACTIVE', is_deleted: false } }),
        prisma.user.count({ where: { role: 'DRIVER', status: 'REJECTED', is_deleted: false } }),
        prisma.user.count({ where: { role: 'DRIVER', status: 'SUSPENDED', is_deleted: false } })
      ]);
      stats = {
        ALL: allCount,
        PENDING: pendingCount,
        ACTIVE: activeCount,
        REJECTED: rejectedCount,
        SUSPENDED: suspendedCount
      };
    }

    res.status(200).json({
      success: true,
      data: users,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        stats
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAllBookings = async (req, res) => {
  try {
    const { status, search = '', page = 1, limit = 10, category } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const whereCondition = {
      is_deleted: false
    };

    if (category) {
      if (category === 'PLANT') {
        whereCondition.cargo_category = 'Plant Hire';
      } else if (category === 'TRANSPORT') {
        whereCondition.cargo_category = { not: 'Plant Hire' };
      }
    }

    if (status && status !== 'All') {
      whereCondition.status = status.toUpperCase();
    }

    if (search) {
      whereCondition.OR = [
        { id: { contains: search } },
        { customer: { user: { first_name: { contains: search } } } },
        { customer: { user: { last_name: { contains: search } } } },
        { customer: { company_name: { contains: search } } }
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: whereCondition,
        skip,
        take: limitNum,
        include: {
          customer: {
            include: { user: true }
          },
          assignments: {
            include: {
              driver: { include: { user: true } },
              fleet_owner: { include: { user: true } }
            }
          }
        },
        orderBy: { created_at: 'desc' }
      }),
      prisma.booking.count({ where: whereCondition })
    ]);

    res.status(200).json({
      success: true,
      data: bookings,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        customer: { include: { user: true } },
        assignments: {
          include: {
            driver: { include: { user: true } },
            fleet_owner: { include: { user: true } },
            broker: { include: { user: true } },
            plant_owner: { include: { user: true } },
            vehicle: true,
            machine: true
          }
        },
        quotes: true,
        documents: true,
        trackings: true
      }
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const assignProvider = async (req, res) => {
  try {
    const { id } = req.params; // Booking ID
    const { driverId, fleetOwnerId, brokerId, plantOwnerId, vehicleId, machineId } = req.body;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    await prisma.$transaction(async (tx) => {
      let effectiveFleetOwnerId = fleetOwnerId;
      if (!effectiveFleetOwnerId && driverId) {
        const drv = await tx.driver.findUnique({ where: { id: driverId } });
        if (drv && drv.fleet_owner_id) {
          effectiveFleetOwnerId = drv.fleet_owner_id;
        }
      }

      // Create assignment
      await tx.bookingAssignment.create({
        data: {
          booking_id: id,
          driver_id: driverId || null,
          fleet_owner_id: effectiveFleetOwnerId || null,
          broker_id: brokerId || null,
          plant_owner_id: plantOwnerId || null,
          vehicle_id: vehicleId || null,
          machine_id: machineId || null,
          assigned_by: req.user.id
        }
      });

      // Update Booking Status to DRIVER_ASSIGNED or similar based on provider
      let newStatus = 'DRIVER_ASSIGNED';
      
      await tx.booking.update({
        where: { id },
        data: { status: newStatus }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: id,
          status: newStatus,
          remarks: 'Admin assigned a provider to the booking',
          updated_by: req.user.id
        }
      });
    });

    res.status(200).json({ success: true, message: 'Provider assigned successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        driver: true,
        fleet_owner: true,
        broker: true,
        plant_owner: true,
        wallets: { include: { transactions: true } }
      }
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Check Wallet Balance
    if (user.wallets && user.wallets.length > 0) {
      const balance = Number(user.wallets[0].balance);
      const pending = Number(user.wallets[0].pending_balance);
      if (balance > 0 || pending > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete: User has active wallet balances or pending settlements.' });
      }
    }

    if (user.role === 'CUSTOMER') {
      const bookingsCount = await prisma.booking.count({ where: { customer_id: user.customer.id } });
      const invoiceCount = await prisma.invoice.count({ where: { customer_id: user.customer.id } });
      if (bookingsCount > 0 || invoiceCount > 0) {
        return res.status(400).json({ success: false, message: 'This customer cannot be deleted because financial records or bookings exist.' });
      }
    }

    if (user.role === 'DRIVER') {
      const activeAssignments = await prisma.bookingAssignment.count({
        where: { driver_id: user.driver.id, booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } }
      });
      if (activeAssignments > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete: Driver has active or pending trips.' });
      }
    }

    if (user.role === 'FLEET_OWNER') {
      const activeAssignments = await prisma.bookingAssignment.count({
        where: { fleet_owner_id: user.fleet_owner.id, booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } }
      });
      if (activeAssignments > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete: Fleet has active assigned bookings or pending payouts.' });
      }
    }

    if (user.role === 'BROKER') {
      const activeAssignments = await prisma.bookingAssignment.count({
        where: { broker_id: user.broker.id, booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } }
      });
      if (activeAssignments > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete: Broker has assigned bookings or pending commissions.' });
      }
    }

    if (user.role === 'PLANT_OWNER') {
      const activeAssignments = await prisma.bookingAssignment.count({
        where: { plant_owner_id: user.plant_owner.id, booking: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } }
      });
      if (activeAssignments > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete: Plant Owner has active jobs or equipment assigned.' });
      }
    }

    // Perform Hard Delete (or Soft Delete depending on preference, but we'll do soft delete with is_deleted flag for safety, as deleting a user might break FKs).
    // The user requested permanent delete rules, so if all constraints pass, we could delete. 
    // We'll soft delete to keep audit integrity, or hard delete if really 0 relations.
    // Let's perform a hard delete if no relations exist.
    await prisma.user.delete({ where: { id: userId } });

    await prisma.activityLog.create({
      data: {
        user_id: req.user.id,
        action: `USER_DELETED`,
        description: `Admin deleted user ${userId} (${user.email})`
      }
    });

    res.status(200).json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    if (booking.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Completed bookings cannot be deleted for accounting integrity.' });
    }

    // Soft delete the booking
    await prisma.booking.update({
      where: { id },
      data: { is_deleted: true }
    });

    await prisma.activityLog.create({
      data: {
        user_id: req.user.id,
        action: `BOOKING_DELETED`,
        description: `Admin deleted booking ${id}`
      }
    });

    res.status(200).json({ success: true, message: 'Booking deleted successfully.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        customer: true,
        driver: {
          include: {
            applications: true,
            assignments: true,
            profile: true,
            photos: true,
            documents_relation: true,
            vehicle_relation: true,
            kyc: true,
            approval: true,
            status_history: {
              include: { changed_by: true },
              orderBy: { created_at: 'desc' }
            },
            fleet_owner: true
          }
        },
        fleet_owner: { include: { vehicles: true, drivers: true } },
        broker: true,
        plant_owner: { include: { machines: true, operators: true } },
        wallets: true
      }
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    let driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });

    if (!driver) {
      const user = await prisma.user.findUnique({
        where: { id: driverId },
        include: { driver: true }
      });
      if (user && user.driver) {
        driver = { ...user.driver, user };
      }
    }

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const userId = driver.user_id || driver.user?.id;

    await prisma.$transaction(async (tx) => {
      // Update User
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' }
      });

      // Update Driver
      await tx.driver.update({
        where: { id: driver.id },
        data: { status: 'INACTIVE' }
      });

      // Update DriverApproval
      await tx.driverApproval.upsert({
        where: { driver_id: driver.id },
        update: {
          status: 'APPROVED',
          approved_by_id: req.user.id,
          approved_at: new Date(),
          rejection_reason: null,
          suspension_reason: null,
          requested_documents: null
        },
        create: {
          driver_id: driver.id,
          status: 'APPROVED',
          approved_by_id: req.user.id,
          approved_at: new Date()
        }
      });

      // Status History
      await tx.driverStatusHistory.create({
        data: {
          driver_id: driver.id,
          old_status: driver.user?.status || 'INACTIVE',
          new_status: 'APPROVED',
          changed_by_id: req.user.id,
          change_reason: 'Admin approved driver credentials'
        }
      });

      const driverEmail = driver.user?.email || 'driver@test.com';

      // Activity Log
      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'DRIVER_APPROVED',
          description: `Admin approved driver ${driverEmail}`
        }
      });
    });

    // Simulate Email Sending
    const driverEmail = driver.user?.email || 'driver@test.com';
    console.log(`✉️ Sending Approval Email to: ${driverEmail}`);
    console.log(`Subject: Welcome to LoadAfrica - Driver Profile Approved!`);
    console.log(`Message: Dear Driver, your profile has been successfully verified. You can now log into your account using your email and password.`);

    // Emit live update to let frontend reload lists without refresh
    const io = req.app.get('io');
    if (io) {
      io.emit('driver_status_changed', { id: userId, status: 'ACTIVE' });
    }

    res.status(200).json({ success: true, message: 'Driver approved successfully and notification sent' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body;
    const userId = driverId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driver: true }
    });

    if (!user || !user.driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const driver = user.driver;

    await prisma.$transaction(async (tx) => {
      // Update User
      await tx.user.update({
        where: { id: userId },
        data: { status: 'REJECTED' }
      });

      // Update Driver
      await tx.driver.update({
        where: { id: driver.id },
        data: { status: 'REJECTED' }
      });

      // Update DriverApproval
      await tx.driverApproval.upsert({
        where: { driver_id: driver.id },
        update: {
          status: 'REJECTED',
          rejection_reason: reason || 'Documents invalid or incomplete',
          rejected_at: new Date()
        },
        create: {
          driver_id: driver.id,
          status: 'REJECTED',
          rejection_reason: reason || 'Documents invalid or incomplete',
          rejected_at: new Date()
        }
      });

      // Status History
      await tx.driverStatusHistory.create({
        data: {
          driver_id: driver.id,
          old_status: user.status,
          new_status: 'REJECTED',
          changed_by_id: req.user.id,
          change_reason: reason || 'Admin rejected driver application'
        }
      });

      // Activity Log
      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'DRIVER_REJECTED',
          description: `Admin rejected driver ${user.email}. Reason: ${reason}`
        }
      });
    });

    console.log(`✉️ Sending Rejection Email to: ${user.email}`);
    console.log(`Reason: ${reason}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('driver_status_changed', { id: userId, status: 'REJECTED' });
    }

    res.status(200).json({ success: true, message: 'Driver rejected successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const suspendDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body;
    const userId = driverId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driver: true }
    });

    if (!user || !user.driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const driver = user.driver;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED' }
      });

      await tx.driver.update({
        where: { id: driver.id },
        data: { status: 'SUSPENDED' }
      });

      await tx.driverApproval.upsert({
        where: { driver_id: driver.id },
        update: {
          status: 'SUSPENDED',
          suspension_reason: reason || 'Violation of terms',
          suspended_at: new Date()
        },
        create: {
          driver_id: driver.id,
          status: 'SUSPENDED',
          suspension_reason: reason || 'Violation of terms',
          suspended_at: new Date()
        }
      });

      await tx.driverStatusHistory.create({
        data: {
          driver_id: driver.id,
          old_status: user.status,
          new_status: 'SUSPENDED',
          changed_by_id: req.user.id,
          change_reason: reason || 'Admin suspended driver account'
        }
      });

      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'DRIVER_SUSPENDED',
          description: `Admin suspended driver ${user.email}. Reason: ${reason}`
        }
      });
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('driver_status_changed', { id: userId, status: 'SUSPENDED' });
    }

    res.status(200).json({ success: true, message: 'Driver suspended successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestMoreDocuments = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { requestedDocs } = req.body;
    const userId = driverId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driver: true }
    });

    if (!user || !user.driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const driver = user.driver;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'PENDING' }
      });

      await tx.driver.update({
        where: { id: driver.id },
        data: { status: 'INACTIVE' }
      });

      await tx.driverApproval.upsert({
        where: { driver_id: driver.id },
        update: {
          status: 'PENDING',
          requested_documents: requestedDocs
        },
        create: {
          driver_id: driver.id,
          status: 'PENDING',
          requested_documents: requestedDocs
        }
      });

      await tx.driverStatusHistory.create({
        data: {
          driver_id: driver.id,
          old_status: user.status,
          new_status: 'PENDING',
          changed_by_id: req.user.id,
          change_reason: `Admin requested correction/resubmission: ${requestedDocs}`
        }
      });
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('driver_status_changed', { id: userId, status: 'PENDING' });
    }

    res.status(200).json({ success: true, message: 'Revision request sent to driver successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const assignDriverFleet = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { fleetOwnerId } = req.body;
    const userId = driverId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { driver: true }
    });

    if (!user || !user.driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const driver = user.driver;

    let targetFleetOwnerId = fleetOwnerId || null;
    if (fleetOwnerId) {
      const directFleet = await prisma.fleetOwner.findUnique({ where: { id: fleetOwnerId } });
      if (!directFleet) {
        // Check if passed ID was a user_id
        const userFleet = await prisma.fleetOwner.findFirst({ where: { user_id: fleetOwnerId } });
        if (userFleet) {
          targetFleetOwnerId = userFleet.id;
        }
      }
    }

    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        fleet_owner_id: targetFleetOwnerId
      }
    });

    await prisma.activityLog.create({
      data: {
        user_id: req.user.id,
        action: 'DRIVER_FLEET_ASSIGNED',
        description: `Admin assigned driver ${user.email} to fleet owner ${targetFleetOwnerId}`
      }
    });

    res.status(200).json({ success: true, message: 'Driver fleet company assigned successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getApprovedFleetOwners = async (req, res) => {
  try {
    const fleetOwners = await prisma.fleetOwner.findMany({
      where: { user: { status: 'ACTIVE', is_deleted: false } },
      include: { user: true }
    });
    res.status(200).json({ success: true, data: fleetOwners });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAdminFinancials = async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { booking: true, customer: { include: { user: true } } },
      orderBy: { created_at: 'desc' }
    });

    const payments = await prisma.payment.findMany({
      include: { invoice: { include: { booking: true } } },
      orderBy: { created_at: 'desc' }
    });

    const walletTransactions = await prisma.walletTransaction.findMany({
      include: { wallet: { include: { user: true } } },
      orderBy: { created_at: 'desc' }
    });

    const totalRevenue = invoices
      .filter(inv => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    const platformEarnings = invoices
      .filter(inv => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.platform_commission), 0);

    const pendingWithdrawals = walletTransactions
      .filter(txn => txn.type === 'DEBIT' && txn.status === 'PENDING')
      .reduce((sum, txn) => sum + Number(txn.amount), 0);

    const paidInvoicesCount = invoices.filter(inv => inv.status === 'PAID').length;

    res.status(200).json({
      success: true,
      data: {
        invoices,
        payments,
        walletTransactions,
        stats: {
          totalRevenue,
          platformEarnings,
          pendingWithdrawals,
          paidInvoicesCount
        }
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createBroker = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, companyName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      // Create User with ACTIVE status since admin is adding directly
      const user = await tx.user.create({
        data: {
          email: email.trim().toLowerCase(),
          password: hashedPassword,
          role: 'BROKER',
          status: 'ACTIVE',
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null
        }
      });

      // Create Broker profile
      await tx.broker.create({
        data: {
          user_id: user.id,
          company_name: companyName || null
        }
      });

      // Create Wallet
      await tx.wallet.create({ data: { user_id: user.id } });

      // Activity log
      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'CREATE_BROKER',
          description: `Admin created broker account for ${email}`
        }
      });

      return user;
    });

    res.status(201).json({
      success: true,
      message: 'Broker created successfully',
      data: { id: result.id, email: result.email, role: result.role }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


const getTransporterMatchingData = async (req, res) => {
  try {
    const searchingBookings = await prisma.booking.findMany({
      where: { 
        status: { in: ['TRANSPORTER_SEARCHING', 'DRIVER_OFFER_SENT', 'MANUAL_ASSIGNMENT_REQUIRED', 'MANUAL_ACTION_REQUIRED'] },
        is_deleted: false
      },
      include: {
        customer: { include: { user: true } },
        load_offers: {
          include: {
            driver: { include: { user: true } }
          },
          orderBy: { created_at: 'desc' }
        }
      },
      orderBy: { updated_at: 'desc' }
    });

    res.status(200).json({ success: true, data: searchingBookings });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPerformanceMetrics = async (req, res) => {
  try {
    const metrics = {
      avgDot: 'N/A',
      avgArriveTime: 'N/A',
      avgCollectionTime: 'N/A',
      totalWeight: 0
    };

    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getComplianceData = async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      where: { is_deleted: false },
      include: {
        user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, status: true } },
        documents_relation: true,
        compliance: {
          orderBy: { last_updated: 'desc' },
          take: 1
        }
      }
    });

    const fleets = await prisma.fleetOwner.findMany({
      include: {
        user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, status: true } }
      }
    });

    const plants = await prisma.plantOwner.findMany({
      include: {
        user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, status: true } }
      }
    });
    
    let totalUniform = 0;
    let totalHygiene = 0;
    let totalDocumentation = 0;
    
    drivers.forEach(d => {
      if (d.compliance && d.compliance.length > 0) {
        const c = d.compliance[0];
        if (c.uniform_standards) totalUniform++;
        if (c.hygiene) totalHygiene++;
        if (c.documentation) totalDocumentation++;
      }
    });

    const totalDrivers = drivers.length;
    const uniformCompliancePct = totalDrivers > 0 ? Math.round((totalUniform / totalDrivers) * 100) : 0;
    const hygieneCompliancePct = totalDrivers > 0 ? Math.round((totalHygiene / totalDrivers) * 100) : 0;
    const docCompliancePct = totalDrivers > 0 ? Math.round((totalDocumentation / totalDrivers) * 100) : 0;

    res.status(200).json({ 
      success: true, 
      data: { 
        drivers,
        fleets,
        plants,
        uniformCompliancePct, 
        hygieneCompliancePct, 
        docCompliancePct 
      } 
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


const getActiveTripsData = async (req, res) => {
  try {
    const activeTrips = await prisma.booking.findMany({
      where: { 
        status: { in: ['IN_TRANSIT', 'DRIVER_EN_ROUTE', 'ARRIVED_PICKUP', 'PICKED_UP', 'LOADING', 'DRIVER_ASSIGNED', 'TRANSPORTER_ASSIGNMENT', 'PAYMENT_RECEIVED'] },
        is_deleted: false 
      },
      include: {
        customer: { include: { user: true } },
        assignments: {
          include: {
            driver: { include: { user: true } },
            vehicle: true
          }
        }
      },
      orderBy: { updated_at: 'desc' }
    });

    res.status(200).json({ success: true, data: activeTrips });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const whereCondition = {};
    if (search) {
      whereCondition.OR = [
        { action: { contains: search } },
        { description: { contains: search } }
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: whereCondition,
        skip,
        take: limitNum,
        include: { user: { select: { email: true, first_name: true, last_name: true } } },
        orderBy: { created_at: 'desc' }
      }),
      prisma.activityLog.count({ where: whereCondition })
    ]);

    res.status(200).json({
      success: true,
      data: logs,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAllVehicleCategories = async (req, res) => {
  try {
    const categories = await prisma.vehicleCategory.findMany({
      where: { is_deleted: false },
      orderBy: { base_price_per_km: 'asc' }
    });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createVehicleCategory = async (req, res) => {
  try {
    const { name, description, base_price_per_km, capacity_tons, is_active } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }
    const rate = Number(base_price_per_km);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ success: false, message: 'Price per KM must be a non-negative number.' });
    }

    const existing = await prisma.vehicleCategory.findFirst({
      where: { name: name.trim(), is_deleted: false }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A vehicle category with this name already exists.' });
    }

    const category = await prisma.vehicleCategory.create({
      data: {
        name: name.trim(),
        description: description || null,
        base_price_per_km: rate,
        capacity_tons: capacity_tons ? Number(capacity_tons) : 1.0,
        is_active: is_active !== undefined ? Boolean(is_active) : true
      }
    });

    res.status(201).json({ success: true, message: 'Vehicle category created successfully.', data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateVehicleCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price_per_km, capacity_tons, is_active } = req.body;

    const category = await prisma.vehicleCategory.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Vehicle category not found.' });
    }

    const updateData = {};
    if (name && name.trim() !== '') updateData.name = name.trim();
    if (description !== undefined) updateData.description = description;
    if (base_price_per_km !== undefined) {
      const rate = Number(base_price_per_km);
      if (isNaN(rate) || rate < 0) {
        return res.status(400).json({ success: false, message: 'Price per KM must be a non-negative number.' });
      }
      updateData.base_price_per_km = rate;
    }
    if (capacity_tons !== undefined) updateData.capacity_tons = Number(capacity_tons);
    if (is_active !== undefined) updateData.is_active = Boolean(is_active);

    const updated = await prisma.vehicleCategory.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({ success: true, message: 'Vehicle category updated successfully.', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const toggleVehicleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await prisma.vehicleCategory.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Vehicle category not found.' });
    }

    const updated = await prisma.vehicleCategory.update({
      where: { id },
      data: { is_active: !category.is_active }
    });

    res.status(200).json({
      success: true,
      message: `Vehicle category ${updated.is_active ? 'activated' : 'deactivated'} successfully.`,
      data: updated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteVehicleCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await prisma.vehicleCategory.findUnique({ where: { id } });
    if (!category || category.is_deleted) {
      return res.status(404).json({ success: false, message: 'Vehicle category not found.' });
    }

    await prisma.vehicleCategory.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: req.user?.id || null
      }
    });

    res.status(200).json({
      success: true,
      message: 'Vehicle category deleted successfully.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getActiveTripsData,
  getTransporterMatchingData,
  getPerformanceMetrics,
  getComplianceData,
  approveDriverKYC,
  approveFleetOwner,
  approveVehicle,
  approvePlantOwner,
  approveMachine,
  getPendingUsers,
  approveUser,
  rejectUser,
  getAllUsers,
  getDashboardStats,
  getUsersByRole,
  getUserById,
  getAllBookings,
  getBookingById,
  assignProvider,
  deleteUser,
  deleteBooking,
  approveDriver,
  rejectDriver,
  suspendDriver,
  requestMoreDocuments,
  assignDriverFleet,
  getApprovedFleetOwners,
  getAdminFinancials,
  createBroker,
  getAuditLogs,
  getAllVehicleCategories,
  createVehicleCategory,
  updateVehicleCategory,
  toggleVehicleCategoryStatus,
  deleteVehicleCategory
};

