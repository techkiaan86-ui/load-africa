const { registerUser, registerDriver, loginUser } = require('../services/authService');
const { z } = require('zod');
const { prisma } = require('../config/db');

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['CUSTOMER', 'DRIVER', 'FLEET_OWNER', 'PLANT_OWNER', 'BROKER']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  vatNumber: z.string().optional(),
  numVehicles: z.number().int().optional(),
  fleetTier: z.string().optional(),
  operatingAreas: z.string().optional(),
  servicesOffered: z.string().optional(),
  notes: z.string().optional(),
  address: z.string().optional(),
  location_lat: z.number().optional(),
  location_lng: z.number().optional(),
  license: z.string().optional(),
  pdp: z.string().optional(),
  idDocument: z.string().optional(),
  vehicleType: z.string().optional(),
  vehicleReg: z.string().optional(),
  licenseFront: z.string().optional(),
  pdpDoc: z.string().optional(),
  vehicleDoc: z.string().optional(),
});

const driverRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string(),
  phone: z.string(),
  profile: z.object({
    dob: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    emergencyContactName: z.string().optional().nullable(),
    emergencyContactPhone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    province: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable()
  }),
  kyc: z.object({
    nationalId: z.string().optional().nullable(),
    licenseNumber: z.string().optional().nullable(),
    licenseExpiry: z.string().optional().nullable()
  }),
  vehicle: z.object({
    fleetOwnerId: z.string().optional().nullable(),
    vehicleType: z.string().optional().nullable(),
    registrationNumber: z.string().optional().nullable(),
    vin: z.string().optional().nullable(),
    capacity: z.number().optional().nullable(),
    manufacturer: z.string().optional().nullable(),
    model: z.string().optional().nullable(),
    year: z.number().optional().nullable(),
    insurance: z.string().optional().nullable(),
    roadworthy: z.string().optional().nullable(),
    licenseDisc: z.string().optional().nullable()
  }),
  documents: z.object({
    profilePhoto: z.string().optional().nullable(),
    selfie: z.string().optional().nullable(),
    govtId: z.string().optional().nullable(),
    licenseFront: z.string().optional().nullable(),
    licenseBack: z.string().optional().nullable(),
    policeClearance: z.string().optional().nullable(),
    medicalCertificate: z.string().optional().nullable(),
    proofOfAddress: z.string().optional().nullable(),
    vehicleRegistration: z.string().optional().nullable(),
    insuranceDoc: z.string().optional().nullable(),
    roadworthyDoc: z.string().optional().nullable()
  })
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const handlePrismaUniqueError = (error, res) => {
  if (error.code === 'P2002') {
    const target = error.meta?.target;
    let fieldName = 'This detail';
    if (Array.isArray(target)) {
      const first = target[0];
      if (first === 'email') fieldName = 'Email Address';
      else if (first === 'phone') fieldName = 'Phone Number';
      else if (first === 'license') fieldName = "Driver's License Number";
      else if (first === 'national_id' || first === 'id_document') fieldName = 'National ID / Passport Number';
      else if (first === 'registration_number') fieldName = 'Vehicle Registration Number';
      else fieldName = first;
    } else if (typeof target === 'string') {
      if (target.includes('email')) fieldName = 'Email Address';
      else if (target.includes('phone')) fieldName = 'Phone Number';
      else if (target.includes('license')) fieldName = "Driver's License Number";
      else if (target.includes('national_id') || target.includes('id_document')) fieldName = 'National ID / Passport Number';
      else if (target.includes('registration_number')) fieldName = 'Vehicle Registration Number';
      else fieldName = target;
    }
    return res.status(400).json({
      success: false,
      message: `${fieldName} is already registered with another account. Please use a different value.`
    });
  }
  return null;
};

const register = async (req, res, next) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    const user = await registerUser(validatedData);
    
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: user,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation Error', errors: error.errors });
    }
    const prismaHandled = handlePrismaUniqueError(error, res);
    if (prismaHandled) return;
    res.status(400).json({ success: false, message: error.message });
  }
};

const registerDriverController = async (req, res, next) => {
  try {
    const validatedData = driverRegisterSchema.parse(req.body);
    const user = await registerDriver(validatedData);

    const io = req.app.get('io');
    if (io) {
      io.emit('driver_registered', {
        id: user.id,
        email: user.email,
        fullName: validatedData.fullName,
        phone: validatedData.phone,
        status: user.status,
        created_at: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: 'Driver registration submitted successfully',
      data: user,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation Error', errors: error.errors });
    }
    const prismaHandled = handlePrismaUniqueError(error, res);
    if (prismaHandled) return;
    res.status(400).json({ success: false, message: error.message });
  }
};

const login = async (req, res, next) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    const result = await loginUser(validatedData.email, validatedData.password);
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation Error', errors: error.errors });
    }
    res.status(401).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        customer: true,
        driver: true,
        fleet_owner: true,
        broker: true,
        plant_owner: true
      }
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
        company_name: user.customer?.company_name || user.fleet_owner?.company_name || user.broker?.company_name || user.plant_owner?.company_name,
        customer: user.customer,
        driver: user.driver,
        fleet_owner: user.fleet_owner,
        broker: user.broker,
        plant_owner: user.plant_owner
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getApprovedFleetOwnersPublic = async (req, res) => {
  try {
    const fleetOwners = await prisma.user.findMany({
      where: { role: 'FLEET_OWNER', status: 'ACTIVE', is_deleted: false },
      include: { fleet_owner: true }
    });
    const formatted = fleetOwners.map(f => ({
      id: f.fleet_owner?.id || f.id,
      name: f.fleet_owner?.company_name || `${f.first_name || 'Fleet'} ${f.last_name || 'Owner'}`
    }));
    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { first_name, last_name, phone, avatar, company_name } = req.body;
    const userId = req.user.id;
    
    const updatedUser = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: {
          first_name: first_name !== undefined ? first_name : undefined,
          last_name: last_name !== undefined ? last_name : undefined,
          phone: phone !== undefined ? phone : undefined,
          avatar: avatar !== undefined ? avatar : undefined,
        },
        include: {
          customer: true,
          driver: true,
          fleet_owner: true,
          broker: true,
          plant_owner: true
        }
      });

      if (company_name !== undefined) {
        if (u.customer?.id) {
          await tx.customer.update({
            where: { id: u.customer.id },
            data: { company_name }
          });
        }
        if (u.fleet_owner?.id) {
          await tx.fleetOwner.update({
            where: { id: u.fleet_owner.id },
            data: { company_name }
          });
        }
      }

      return u;
    });

    res.status(200).json({ 
      success: true, 
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id,
        first_name: updatedUser.first_name,
        last_name: updatedUser.last_name,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        email: updatedUser.email,
        role: updatedUser.role,
        company_name: company_name || updatedUser.customer?.company_name
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { register, registerDriver: registerDriverController, login, getMe, getApprovedFleetOwnersPublic, updateProfile };
