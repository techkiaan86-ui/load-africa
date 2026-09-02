const { prisma } = require('../config/db');
const bcrypt = require('bcrypt');

// Helper to get plant owner ID (auto-creates PlantOwner if missing)
const getPlantOwnerId = async (req) => {
  if (req.user && req.user.role === 'PLANT_OWNER') {
    let plantOwner = await prisma.plantOwner.findUnique({
      where: { user_id: req.user.id }
    });
    if (plantOwner) return plantOwner.id;

    // Auto-create PlantOwner record if user has PLANT_OWNER role but no profile yet
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    plantOwner = await prisma.plantOwner.create({
      data: {
        user_id: req.user.id,
        company_name: user ? `${user.first_name || 'Plant'} ${user.last_name || 'Owner'}` : 'Plant Owner',
        status: 'ACTIVE'
      }
    });
    return plantOwner.id;
  }
  throw new Error('Plant Owner not found or unauthorized');
};

const getDashboard = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const plantOwner = await prisma.plantOwner.findUnique({
      where: { id: plantOwnerId },
      include: {
        user: true,
        machines: true,
        operators: true,
        hire_requests: {
          where: {
            OR: [
              { status: 'PENDING', booking: { status: { in: ['PAYMENT_RECEIVED', 'DRIVER_SEARCHING'] } } },
              { status: { in: ['ACCEPTED', 'ON_HIRE'] } }
            ]
          },
          include: {
            booking: {
              include: {
                quotes: {
                  where: { status: 'ACCEPTED' }
                }
              }
            }
          }
        }
      }
    });

    if (!plantOwner) return res.status(404).json({ success: false, message: 'Plant Owner not found' });

    res.status(200).json({
      success: true,
      data: plantOwner
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMachines = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const machines = await prisma.machine.findMany({
      where: {
        plant_owner_id: plantOwnerId,
        is_deleted: false
      },
      orderBy: { created_at: 'desc' }
    });

    const formattedMachines = machines.map(m => {
      let docsObj = {};
      if (m.machine_documents) {
        try { docsObj = typeof m.machine_documents === 'string' ? JSON.parse(m.machine_documents) : m.machine_documents; } catch (e) {}
      }
      return {
        ...m,
        image_url: docsObj.photo_url || docsObj.image_url || docsObj.photo || null
      };
    });

    res.status(200).json({ success: true, data: formattedMachines });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitCompliance = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { company_documents } = req.body;

    const plantOwner = await prisma.plantOwner.update({
      where: { id: plantOwnerId },
      data: {
        status: 'UNDER_REVIEW',
        company_documents: typeof company_documents === 'object' ? JSON.stringify(company_documents) : company_documents
      }
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        entity_type: 'PlantOwner',
        entity_id: plantOwnerId,
        action: 'SUBMIT_COMPLIANCE',
        new_value: 'UNDER_REVIEW'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Compliance documents submitted successfully. Account is now under review.',
      data: plantOwner
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const addMachine = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { 
      type, 
      capacity, 
      registration_number, 
      machine_documents,
      image_url,
      photo_url,
      category,
      make,
      model_name,
      year,
      hourly_rate,
      min_hire_hours
    } = req.body;

    // Check if registration_number already exists
    const existingMachine = await prisma.machine.findFirst({
      where: { registration_number, is_deleted: false }
    });
    if (existingMachine) {
      return res.status(400).json({
        success: false,
        message: `Registration / Serial Number '${registration_number}' is already registered for another machine. Please enter a unique registration number.`
      });
    }

    const plantOwner = await prisma.plantOwner.findUnique({ where: { id: plantOwnerId } });
    const initialStatus = plantOwner?.status === 'ACTIVE' ? 'AVAILABLE' : 'CREATED';

    let docsObj = {};
    if (typeof machine_documents === 'object' && machine_documents !== null) {
      docsObj = { ...machine_documents };
    } else if (typeof machine_documents === 'string') {
      try { docsObj = JSON.parse(machine_documents); } catch (e) { docsObj = { raw: machine_documents }; }
    }
    const finalPhotoUrl = image_url || photo_url || docsObj.photo_url || docsObj.image_url;
    if (finalPhotoUrl) {
      docsObj.photo_url = finalPhotoUrl;
      docsObj.image_url = finalPhotoUrl;
    }

    const machine = await prisma.machine.create({
      data: {
        plant_owner_id: plantOwnerId,
        type,
        category,
        make,
        model_name,
        year: year ? parseInt(year, 10) : null,
        hourly_rate: hourly_rate ? parseFloat(hourly_rate) : null,
        min_hire_hours: min_hire_hours ? parseInt(min_hire_hours, 10) : null,
        capacity: parseFloat(capacity) || 0,
        registration_number,
        status: initialStatus,
        machine_documents: JSON.stringify(docsObj)
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...machine,
        image_url: finalPhotoUrl || null
      }
    });
  } catch (error) {
    console.error("ADD_MACHINE_ERROR:", error);
    if (error.code === 'P2002' || error.message.includes('Unique constraint')) {
      return res.status(400).json({
        success: false,
        message: 'Registration / Serial Number already exists. Please use a unique registration number.'
      });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const acceptHireRequest = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { requestId } = req.params;
    const { machine_id, operator_id } = req.body;

    const plantOwner = await prisma.plantOwner.findUnique({ where: { id: plantOwnerId } });
    if (plantOwner.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Plant Owner account is not active.' });
    }

    const machine = await prisma.machine.findUnique({ where: { id: machine_id } });
    if (!machine) {
      return res.status(404).json({ success: false, message: 'Machine not found.' });
    }

    let assignmentResult;

    await prisma.$transaction(async (tx) => {
      // 1. Update hire request status
      const request = await tx.hireRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' }
      });

      // 2. Update booking status
      await tx.booking.update({
        where: { id: request.booking_id },
        data: { status: 'DRIVER_ASSIGNED' }
      });

      // 3. Create or update BookingAssignment
      const finalOperatorId = operator_id && operator_id.trim() !== "" ? operator_id : null;
      let assignment = await tx.bookingAssignment.findFirst({
        where: { booking_id: request.booking_id, plant_owner_id: plantOwnerId }
      });
      
      if (assignment) {
        assignment = await tx.bookingAssignment.update({
          where: { id: assignment.id },
          data: { status: 'ACTIVE', machine_id, operator_id: finalOperatorId }
        });
      } else {
        assignment = await tx.bookingAssignment.create({
          data: {
            booking_id: request.booking_id,
            plant_owner_id: plantOwnerId,
            status: 'ACTIVE',
            machine_id,
            operator_id: finalOperatorId
          }
        });
      }
      assignmentResult = assignment;

      // 5. Create tracking history log
      await tx.trackingHistory.create({
        data: {
          booking_id: request.booking_id,
          status: 'DRIVER_ASSIGNED',
          remarks: 'Plant owner accepted assignment and dispatched machinery',
          updated_by: req.user.id
        }
      });
    });

    res.status(200).json({ success: true, data: assignmentResult });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const rejectHireRequest = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { requestId } = req.params;

    const request = await prisma.hireRequest.findUnique({
      where: { id: requestId }
    });
    if (!request) return res.status(404).json({ success: false, message: 'Hire request not found' });

    await prisma.$transaction(async (tx) => {
      // 1. Update hire request status
      await tx.hireRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED' }
      });

      // 2. Set the pending assignment to INACTIVE
      await tx.bookingAssignment.updateMany({
        where: { booking_id: request.booking_id, plant_owner_id: plantOwnerId, status: 'PENDING' },
        data: { status: 'INACTIVE' }
      });

      // 3. Set booking status back to CUSTOMER_ACCEPTED so it is back in broker queue
      await tx.booking.update({
        where: { id: request.booking_id },
        data: { status: 'CUSTOMER_ACCEPTED' }
      });

      // 4. Create tracking history log
      await tx.trackingHistory.create({
        data: {
          booking_id: request.booking_id,
          status: 'CUSTOMER_ACCEPTED',
          remarks: 'Plant supplier rejected assignment. Reverted to awaiting broker dispatch.',
          updated_by: req.user.id
        }
      });
    });

    res.status(200).json({ success: true, message: 'Hire request rejected successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPublicMachines = async (req, res) => {
  try {
    const machines = await prisma.machine.findMany({
      where: {
        status: { in: ['AVAILABLE', 'APPROVED', 'ACTIVE'] }
      },
      include: {
        plant_owner: {
          select: {
            company_name: true,
            status: true
          }
        }
      }
    });
    res.status(200).json({ success: true, data: machines });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


const getMachineOperators = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const operators = await prisma.machineOperator.findMany({
      where: { plant_owner_id: plantOwnerId, is_deleted: false },
      include: { user: { select: { email: true, first_name: true, last_name: true } } },
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: operators });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const fs = require('fs');

const addMachineOperator = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { email, password, first_name, last_name, license, name } = req.body;

    if (!email || !password || !license) {
      console.log('ADD_OPERATOR_400: Missing required fields');
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      console.log('ADD_OPERATOR_400: Email already exists', email);
      return res.status(400).json({ success: false, message: 'Email already exists! Please use a different email.' });
    }

    const existingLicense = await prisma.machineOperator.findUnique({ where: { license } });
    if (existingLicense) {
      console.log('ADD_OPERATOR_400: License already exists', license);
      return res.status(400).json({ success: false, message: 'License number already exists! Please use a unique license.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const operatorName = name || `${first_name} ${last_name}`;

    let newOperator;
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'OPERATOR',
          first_name,
          last_name,
          status: 'ACTIVE',
          is_verified: true
        }
      });

      newOperator = await tx.machineOperator.create({
        data: {
          user_id: user.id,
          plant_owner_id: plantOwnerId,
          name: operatorName,
          license
        }
      });
    });

    res.status(201).json({ success: true, data: newOperator });
  } catch (error) {
    fs.appendFileSync('error.log', `\n[${new Date().toISOString()}] ADD_OPERATOR_ERROR: ${error.message}\n${error.stack}\n`);
    console.error("ADD_OPERATOR_ERROR:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMachineOperator = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { id } = req.params;

    const operator = await prisma.machineOperator.findFirst({
      where: { id, plant_owner_id: plantOwnerId }
    });

    if (!operator) {
      return res.status(404).json({ success: false, message: 'Operator not found' });
    }

    await prisma.machineOperator.update({
      where: { id },
      data: { is_deleted: true }
    });

    if (operator.user_id) {
      await prisma.user.update({
        where: { id: operator.user_id },
        data: { is_deleted: true, status: 'INACTIVE' }
      });
    }

    res.status(200).json({ success: true, message: 'Operator deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMachine = async (req, res) => {
  try {
    const plantOwnerId = await getPlantOwnerId(req);
    const { id } = req.params;

    const machine = await prisma.machine.findFirst({
      where: { id, plant_owner_id: plantOwnerId }
    });

    if (!machine) {
      return res.status(404).json({ success: false, message: 'Machine not found or unauthorized' });
    }

    await prisma.machine.update({
      where: { id },
      data: { is_deleted: true }
    });

    res.status(200).json({ success: true, message: 'Machine deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDashboard,
  getMachines,
  submitCompliance,
  addMachine,
  deleteMachine,
  acceptHireRequest,
  rejectHireRequest,
  getPublicMachines,
  getMachineOperators,
  addMachineOperator,
  deleteMachineOperator
};
