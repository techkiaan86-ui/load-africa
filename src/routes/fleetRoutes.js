const express = require('express');
const {
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
} = require('../controllers/fleetController');

const router = express.Router();

const { verifyToken } = require('../utils/jwt');
const { prisma } = require('../config/db');

// Extracts user if token exists, but doesn't strictly enforce ACTIVE status
const softProtect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      if (decoded) {
        req.user = await prisma.user.findUnique({ where: { id: decoded.id } });
      }
    }
    next();
  } catch (error) {
    next();
  }
};

router.get('/dashboard', softProtect, getDashboard);
router.post('/compliance/submit', softProtect, submitCompliance);

// Profile Management
router.get('/profile', softProtect, getProfile);
router.put('/profile', softProtect, updateProfile);
router.post('/bank-details', softProtect, saveBankDetails);

// Vehicle CRUD
router.get('/vehicles', softProtect, getVehicles);
router.post('/vehicles', softProtect, addVehicle);
router.put('/vehicles/:id', softProtect, updateVehicle);
router.delete('/vehicles/:id', softProtect, deleteVehicle);

// Driver CRUD
router.get('/drivers', softProtect, getDrivers);
router.post('/drivers', softProtect, addDriver);
router.put('/drivers/:id', softProtect, updateDriver);
router.put('/drivers/:id/status', softProtect, updateDriverStatus);
router.delete('/drivers/:id', softProtect, deleteDriver);

// Load Management & Dispatch
router.get('/offers', softProtect, getPendingOffers);
router.post('/offers/:id/accept', softProtect, acceptLoadOffer);
router.post('/offers/:id/reject', softProtect, rejectLoadOffer);
router.get('/loads', softProtect, getLoads);
router.post('/loads/:id/dispatch', softProtect, acceptAndDispatch);

module.exports = router;
