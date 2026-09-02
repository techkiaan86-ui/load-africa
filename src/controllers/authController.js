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
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0] || 'A unique field';
      return res.status(400).json({ success: false, message: `${field} is already registered. Please use a unique value.` });
    }
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
  res.status(200).json({
    success: true,
    data: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      status: req.user.status,
    }
  });
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
    const { first_name, last_name, phone, avatar } = req.body;
    const userId = req.user.id;
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        first_name: first_name !== undefined ? first_name : undefined,
        last_name: last_name !== undefined ? last_name : undefined,
        phone: phone !== undefined ? phone : undefined,
        avatar: avatar !== undefined ? avatar : undefined,
      }
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
        role: updatedUser.role
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { register, registerDriver: registerDriverController, login, getMe, getApprovedFleetOwnersPublic, updateProfile };
