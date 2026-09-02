const express = require('express');
const { 
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
  getTransporterMatchingData,
  getPerformanceMetrics,
  getComplianceData,
  getActiveTripsData,
  getAuditLogs,
  getAllVehicleCategories,
  createVehicleCategory,
  updateVehicleCategory,
  toggleVehicleCategoryStatus,
  deleteVehicleCategory
} = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Apply auth and admin role requirement to all admin routes
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// Vehicle Category Management (Admin Only)
router.get('/vehicle-categories', getAllVehicleCategories);
router.post('/vehicle-categories', createVehicleCategory);
router.put('/vehicle-categories/:id', updateVehicleCategory);
router.patch('/vehicle-categories/:id/status', toggleVehicleCategoryStatus);
router.delete('/vehicle-categories/:id', deleteVehicleCategory);

// User Approval & Management Endpoints
router.get('/dashboard-stats', getDashboardStats);
router.get('/matching-data', getTransporterMatchingData);
router.get('/performance-metrics', getPerformanceMetrics);
router.get('/compliance-data', getComplianceData);
router.get('/active-trips', getActiveTripsData);
router.get('/users', getAllUsers);
router.get('/users/role', getUsersByRole);
router.get('/users/:id', getUserById);
router.get('/pending-users', getPendingUsers);
router.post('/users/approve/:userId', approveUser);
router.post('/users/reject/:userId', rejectUser);

// Driver Action Endpoints
router.post('/drivers/:driverId/approve', approveDriver);
router.post('/drivers/:driverId/reject', rejectDriver);
router.post('/drivers/:driverId/suspend', suspendDriver);
router.post('/drivers/:driverId/request-docs', requestMoreDocuments);
router.post('/drivers/:driverId/assign-fleet', assignDriverFleet);
router.get('/fleet-owners/approved', getApprovedFleetOwners);

// Booking Management
router.get('/bookings', getAllBookings);
router.get('/bookings/:id', getBookingById);
router.post('/bookings/:id/assign', assignProvider);
router.delete('/bookings/:id', deleteBooking);

// Legacy/Specific Entity Approvals
router.post('/kyc/approve/:driverId', approveDriverKYC);
router.post('/fleet/approve/:fleetId', approveFleetOwner);
router.post('/vehicle/approve/:vehicleId', approveVehicle);
router.post('/plant/approve/:plantId', approvePlantOwner);
router.post('/machine/approve/:machineId', approveMachine);

// Delete User
router.delete('/users/:userId', deleteUser);

// Payments & Financials Ledger
router.get('/payments', getAdminFinancials);

// Broker Management
router.post('/brokers/create', createBroker);

router.get('/audit-logs', getAuditLogs);

module.exports = router;
