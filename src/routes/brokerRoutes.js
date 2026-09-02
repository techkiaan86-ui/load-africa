const express = require('express');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');
const {
  getQuoteRequests,
  getQuotations,
  getActiveBookings,
  getPlantHireRequests,
  submitQuote,
  getAssignedLoads,
  getDashboardStats,
  getCommissions,
  getCustomers,
  assignFleet,
  getApprovedFleetOwners,
  getApprovedPlantOwners,
  assignPlant
} = require('../controllers/brokerController');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('BROKER'));

router.get('/dashboard', getDashboardStats);
router.get('/quotes/requests', getQuoteRequests);

router.get('/quotes', getQuotations);
router.get('/active-bookings', getActiveBookings);
router.get('/plant-hire', getPlantHireRequests);
router.post('/quotes/:bookingId', submitQuote);
router.get('/assigned-loads', getAssignedLoads);
router.get('/commissions', getCommissions);
router.get('/customers', getCustomers);
router.post('/bookings/:id/assign-fleet', assignFleet);
router.post('/bookings/:id/assign-plant', assignPlant);
router.get('/fleet-owners', getApprovedFleetOwners);
router.get('/plant-owners', getApprovedPlantOwners);

module.exports = router;
