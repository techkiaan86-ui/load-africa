const { prisma } = require('../config/db');
const bcrypt = require('bcrypt');

const getAdminUserId = async (req) => {
  if (req.user) return req.user.id;
  // Fallback to a seeded super-admin or first admin if testing without strict auth context
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  return adminUser ? adminUser.id : null;
};

// 1. Submit Public Application
const submitApplication = async (req, res) => {
  try {
    const {
      company_name,
      contact_name,
      email,
      phone,
      password,
      national_id,
      equipment_type,
      make,
      model,
      registration_number,
      year,
      base_location,
      company_reg_doc,
      machine_photo
    } = req.body;

    if (!company_name || !contact_name || !email || !phone || !national_id || !equipment_type || !registration_number || !base_location) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided.' });
    }

    const existingMachine = await prisma.machine.findUnique({
      where: { registration_number }
    });
    if (existingMachine) {
      return res.status(400).json({
        success: false,
        message: `A machine with registration number '${registration_number}' is already registered.`
      });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const app = await prisma.plantOwnerApplication.create({
      data: {
        company_name,
        contact_name,
        email,
        phone,
        password: hashedPassword,
        national_id,
        equipment_type,
        make: make || null,
        model: model || null,
        registration_number,
        year: year ? parseInt(year) : null,
        base_location,
        company_reg_doc: company_reg_doc || null,
        machine_photo: machine_photo || null,
        status: 'PENDING'
      }
    });

    res.status(201).json({ success: true, data: app });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 2. Get Applications (Admin)
const getApplications = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    const apps = await prisma.plantOwnerApplication.findMany({
      where,
      orderBy: { created_at: 'desc' }
    });
    res.status(200).json({ success: true, data: apps });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 3. Get Application Details
const getApplicationDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const app = await prisma.plantOwnerApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
    res.status(200).json({ success: true, data: app });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 4. Approve Application
const approveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const actorId = await getAdminUserId(req);

    const app = await prisma.plantOwnerApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
    if (app.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Application is already approved' });
    }

    const existingMachine = await prisma.machine.findUnique({
      where: { registration_number: app.registration_number }
    });
    if (existingMachine) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve: A machine with registration number '${app.registration_number}' is already registered.`
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update Application status
      const updatedApp = await tx.plantOwnerApplication.update({
        where: { id },
        data: { status: 'APPROVED' }
      });

      // 2. Check if user already exists
      let user = await tx.user.findUnique({ where: { email: app.email } });
      if (!user) {
        // Use user's submitted password hash if available, otherwise fallback
        const userPassword = app.password || await bcrypt.hash('LoadAfricaPlant2026!', 10);
        user = await tx.user.create({
          data: {
            email: app.email,
            password: userPassword,
            role: 'PLANT_OWNER',
            status: 'ACTIVE',
            is_verified: true,
            first_name: app.contact_name.split(' ')[0] || 'Plant',
            last_name: app.contact_name.split(' ').slice(1).join(' ') || 'Owner',
            phone: app.phone
          }
        });
      } else {
        // Update user status and role if it exists but wasn't active
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            role: 'PLANT_OWNER',
            status: 'ACTIVE'
          }
        });
      }

      // 3. Create PlantOwner profile
      let plantOwner = await tx.plantOwner.findUnique({ where: { user_id: user.id } });
      if (!plantOwner) {
        plantOwner = await tx.plantOwner.create({
          data: {
            user_id: user.id,
            company_name: app.company_name,
            status: 'ACTIVE',
            company_documents: JSON.stringify({
              registration_document: app.company_reg_doc,
              national_id: app.national_id,
              base_location: app.base_location
            })
          }
        });
      }

      // 4. Create machine for the newly approved plant owner
      await tx.machine.create({
        data: {
          plant_owner_id: plantOwner.id,
          type: app.equipment_type,
          capacity: null,
          registration_number: app.registration_number,
          status: 'AVAILABLE',
          machine_documents: JSON.stringify({
            photo: app.machine_photo,
            make: app.make,
            model: app.model,
            year: app.year
          })
        }
      });

      // 5. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          entity_type: 'PlantOwnerApplication',
          entity_id: id,
          action: 'APPROVED',
          old_value: app.status,
          new_value: 'APPROVED',
          actor_id: actorId
        }
      });

      return updatedApp;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 5. Reject Application
const rejectApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actorId = await getAdminUserId(req);

    const app = await prisma.plantOwnerApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const result = await prisma.$transaction(async (tx) => {
      const updatedApp = await tx.plantOwnerApplication.update({
        where: { id },
        data: { status: 'REJECTED', rejection_reason: reason || 'Rejected by Admin' }
      });

      await tx.auditLog.create({
        data: {
          entity_type: 'PlantOwnerApplication',
          entity_id: id,
          action: 'REJECTED',
          old_value: app.status,
          new_value: 'REJECTED',
          actor_id: actorId
        }
      });

      // Insert notification
      await tx.notification.create({
        data: {
          recipient_email: app.email,
          recipient_phone: app.phone,
          type: 'EMAIL',
          title: 'Plant Owner Application Rejected',
          content: `Dear ${app.contact_name}, your application to list plant on LoadAfrica was rejected. Reason: ${reason || 'Does not match compliance guidelines.'}`,
          status: 'PENDING'
        }
      });

      return updatedApp;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 6. Request Changes
const requestChanges = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actorId = await getAdminUserId(req);

    const app = await prisma.plantOwnerApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const result = await prisma.$transaction(async (tx) => {
      const updatedApp = await tx.plantOwnerApplication.update({
        where: { id },
        data: { status: 'CHANGES_REQUESTED', rejection_reason: reason || 'Changes requested by Admin' }
      });

      await tx.auditLog.create({
        data: {
          entity_type: 'PlantOwnerApplication',
          entity_id: id,
          action: 'CHANGES_REQUESTED',
          old_value: app.status,
          new_value: 'CHANGES_REQUESTED',
          actor_id: actorId
        }
      });

      // Insert notification
      await tx.notification.create({
        data: {
          recipient_email: app.email,
          recipient_phone: app.phone,
          type: 'EMAIL',
          title: 'Changes Requested on Plant Application',
          content: `Dear ${app.contact_name}, changes have been requested for your plant listing registration. Comments: ${reason || 'Please check documents again.'}`,
          status: 'PENDING'
        }
      });

      return updatedApp;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  submitApplication,
  getApplications,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
  requestChanges
};
