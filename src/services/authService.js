const bcrypt = require('bcrypt');
const { prisma } = require('../config/db');
const { generateToken } = require('../utils/jwt');

const registerUser = async (data) => {
  const { email, password, role, firstName, lastName, phone, companyName, vatNumber, numVehicles, fleetTier, operatingAreas, servicesOffered, notes, address, location_lat, location_lng, license, pdp, idDocument, vehicleType, vehicleReg, licenseFront, pdpDoc, vehicleDoc } = data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('Email already in use');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Prisma Transaction for User + Profile Creation + Wallet
  const result = await prisma.$transaction(async (tx) => {
    const status = ['CUSTOMER', 'DRIVER', 'FLEET_OWNER', 'PLANT_OWNER', 'BROKER'].includes(role) ? 'PENDING' : 'ACTIVE';

    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        role,
        status,
        first_name: firstName,
        last_name: lastName,
        phone
      },
    });

    // Create Profile Based on Role
    if (role === 'CUSTOMER') {
      await tx.customer.create({ data: { user_id: user.id, company_name: companyName } });
    } else if (role === 'DRIVER') {
      const driver = await tx.driver.create({
        data: {
          user_id: user.id,
          license: license || null,
          pdp: pdp || null,
          id_document: idDocument || null,
          status: 'INACTIVE',
          address: address || null,
          documents: JSON.stringify({
            vehicleType: vehicleType || '',
            vehicleReg: vehicleReg || ''
          })
        }
      });
      // Initialize empty relational models for this driver to prevent null lookup errors
      await tx.driverProfile.create({ data: { driver_id: driver.id, onboarding_completed: false } });
      await tx.driverPhoto.create({ data: { driver_id: driver.id } });
      await tx.driverDocuments.create({
        data: {
          driver_id: driver.id,
          license_front: licenseFront || null,
          police_clearance: pdpDoc || null,
          roadworthy_certificate: vehicleDoc || null,
          govt_id: idDocument || null
        }
      });
      await tx.driverKYC.create({ data: { driver_id: driver.id } });
      await tx.driverApproval.create({ data: { driver_id: driver.id, status: 'PENDING' } });
    } else if (role === 'FLEET_OWNER') {
      await tx.fleetOwner.create({
        data: {
          user_id: user.id,
          company_name: companyName,
          vat_number: vatNumber,
          num_vehicles: numVehicles,
          fleet_tier: fleetTier,
          operating_areas: operatingAreas,
          services_offered: servicesOffered,
          notes: notes,
          address: address,
          location_lat: location_lat,
          location_lng: location_lng,
          status: 'PENDING_APPROVAL'
        }
      });
    } else if (role === 'PLANT_OWNER') {
      await tx.plantOwner.create({ data: { user_id: user.id, company_name: companyName } });
    } else if (role === 'BROKER') {
      await tx.broker.create({ data: { user_id: user.id, company_name: companyName } });
    } else if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      await tx.admin.create({ data: { user_id: user.id } });
    }

    // Create Wallet
    await tx.wallet.create({ data: { user_id: user.id } });

    // Create Audit Log
    await tx.activityLog.create({
      data: {
        user_id: user.id,
        action: 'REGISTER',
        description: 'User registered via Auth Service',
      }
    });

    return user;
  });

  return { id: result.id, email: result.email, role: result.role };
};

const registerDriver = async (data) => {
  let { email, password, fullName, phone, profile, kyc, vehicle, documents } = data;
  email = email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('Email already in use. Please use a different email address.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create User
    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'DRIVER',
        status: 'PENDING',
        first_name: fullName.split(' ')[0],
        last_name: fullName.split(' ').slice(1).join(' '),
        phone,
        avatar: documents?.profilePhoto || null
      }
    });

    // 2. Create Driver
    const driver = await tx.driver.create({
      data: {
        user_id: user.id,
        license: kyc.licenseNumber || null,
        national_id: kyc.nationalId || null,
        license_expiry: kyc.licenseExpiry ? new Date(kyc.licenseExpiry) : null,
        status: 'INACTIVE',
        fleet_owner_id: vehicle.driverType === 'FLEET' ? vehicle.fleetOwnerId : null,
        address: profile.address || null
      }
    });

    // 3. Create DriverProfile
    await tx.driverProfile.create({
      data: {
        driver_id: driver.id,
        date_of_birth: profile.dob ? new Date(profile.dob) : null,
        gender: profile.gender || null,
        emergency_contact: profile.emergencyContactName ? {
          name: profile.emergencyContactName,
          phone: profile.emergencyContactPhone
        } : null,
        address: profile.address || null,
        province: profile.province || null,
        city: profile.city || null,
        gps_lat: parseFloat(profile.lat) || null,
        gps_lng: parseFloat(profile.lng) || null,
        onboarding_completed: false
      }
    });

    // 4. Create DriverPhoto
    await tx.driverPhoto.create({
      data: {
        driver_id: driver.id,
        profile_photo: documents.profilePhoto || null,
        selfie: documents.selfie || null,
        vehicle_front: null,
        vehicle_back: null,
        vehicle_left: null,
        vehicle_right: null
      }
    });

    // 5. Create DriverDocuments
    await tx.driverDocuments.create({
      data: {
        driver_id: driver.id,
        govt_id: documents.govtId || null,
        license_front: documents.licenseFront || null,
        license_back: documents.licenseBack || null,
        police_clearance: documents.policeClearance || null,
        medical_certificate: documents.medicalCertificate || null,
        proof_of_address: documents.proofOfAddress || null,
        vehicle_registration: null,
        insurance: null,
        roadworthy_certificate: null
      }
    });
    // 7. Create DriverKYC
    await tx.driverKYC.create({
      data: {
        driver_id: driver.id,
        national_id: kyc.nationalId || null,
        license_number: kyc.licenseNumber || null,
        license_expiry: kyc.licenseExpiry ? new Date(kyc.licenseExpiry) : null
      }
    });

    // 8. Create DriverApproval
    await tx.driverApproval.create({
      data: {
        driver_id: driver.id,
        status: 'PENDING'
      }
    });

    // 9. Create DriverStatusHistory
    await tx.driverStatusHistory.create({
      data: {
        driver_id: driver.id,
        new_status: 'PENDING',
        change_reason: 'Initial Driver Registration'
      }
    });

    // 10. Create Wallet
    await tx.wallet.create({
      data: {
        user_id: user.id
      }
    });

    // 11. Create Activity Log
    await tx.activityLog.create({
      data: {
        user_id: user.id,
        action: 'REGISTER_DRIVER',
        description: 'Driver completed the 5-step registration workflow.'
      }
    });

    return user;
  });

  return { id: result.id, email: result.email, role: result.role, status: result.status };
};

const DUMMY_USERS = {
  'patrice@arm.co.za': 'CUSTOMER',
  'sipho.zuma@load-driver.co.za': 'DRIVER',
  'fleet@loadafrica.co.za': 'FLEET_OWNER',
  'plant@loadafrica.co.za': 'PLANT_OWNER',
  'admin@loadafrica.com': 'ADMIN',
  'lwazi.dlamini@loadafrica-broker.co.za': 'BROKER'
};

const loginUser = async (email, password) => {
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    if (DUMMY_USERS[email]) {
      // Auto-register dummy user
      const role = DUMMY_USERS[email];
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: { email, password: hashedPassword, role, status: 'ACTIVE' },
        });
        if (role === 'CUSTOMER') await tx.customer.create({ data: { user_id: newUser.id } });
        else if (role === 'DRIVER') {
          const driver = await tx.driver.create({ data: { user_id: newUser.id } });
          // Initialize relational tables for dummy driver
          await tx.driverProfile.create({ data: { driver_id: driver.id, onboarding_completed: true } });
          await tx.driverPhoto.create({ data: { driver_id: driver.id } });
          await tx.driverDocuments.create({ data: { driver_id: driver.id } });
          await tx.driverKYC.create({ data: { driver_id: driver.id } });
          await tx.driverApproval.create({ data: { driver_id: driver.id, status: 'APPROVED' } });
        }
        else if (role === 'FLEET_OWNER') await tx.fleetOwner.create({ data: { user_id: newUser.id } });
        else if (role === 'PLANT_OWNER') await tx.plantOwner.create({ data: { user_id: newUser.id } });
        else if (role === 'BROKER') await tx.broker.create({ data: { user_id: newUser.id } });
        else if (role === 'ADMIN') await tx.admin.create({ data: { user_id: newUser.id } });
        await tx.wallet.create({ data: { user_id: newUser.id } });
        return newUser;
      });
    } else {
      throw new Error('Invalid email or password');
    }
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  // Auto-activate dummy users if they are suspended/pending
  if (user.status !== 'ACTIVE' && DUMMY_USERS[email]) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE' }
    });
  }

  // Handle custom approval workflow status checks
  if (user.status === 'PENDING') {
    throw new Error('Your account is under review.');
  }

  if (user.status === 'REJECTED') {
    let reason = '';
    if (user.role === 'DRIVER') {
      const driver = await prisma.driver.findUnique({
        where: { user_id: user.id },
        include: { approval: true }
      });
      if (driver?.approval?.rejection_reason) {
        reason = ` Reason: ${driver.approval.rejection_reason}`;
      }
    }
    throw new Error(`Your account has been rejected.${reason}`);
  }

  if (user.status === 'SUSPENDED') {
    let reason = '';
    if (user.role === 'DRIVER') {
      const driver = await prisma.driver.findUnique({
        where: { user_id: user.id },
        include: { approval: true }
      });
      if (driver?.approval?.suspension_reason) {
        reason = ` Reason: ${driver.approval.suspension_reason}`;
      }
    }
    throw new Error(`Your account has been suspended.${reason}`);
  }

  if (user.status !== 'ACTIVE') {
    throw new Error('Account is suspended or inactive');
  }

  const token = generateToken(user.id, user.role);

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login: new Date() }
  });

  await prisma.activityLog.create({
    data: {
      user_id: user.id,
      action: 'LOGIN',
      description: 'User logged in via Auth Service',
    }
  });

  // Check driver onboarding completed state
  let onboardingCompleted = false;
  if (user.role === 'DRIVER') {
    const driver = await prisma.driver.findUnique({
      where: { user_id: user.id },
      include: { profile: true }
    });
    if (driver?.profile?.onboarding_completed) {
      onboardingCompleted = true;
    }
  }

  // Fetch broker info if role is BROKER
  let brokerInfo = null;
  if (user.role === 'BROKER') {
    brokerInfo = await prisma.broker.findUnique({ where: { user_id: user.id } });
  }

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      avatar: user.avatar,
      created_at: user.created_at,
      onboarding_completed: onboardingCompleted,
      broker: brokerInfo ? { id: brokerInfo.id, company_name: brokerInfo.company_name } : undefined
    }
  };
};

module.exports = { registerUser, registerDriver, loginUser };
