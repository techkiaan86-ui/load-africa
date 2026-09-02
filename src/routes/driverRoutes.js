const express = require('express');
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  getAvailableLoads,
  applyForLoad,
  getActiveTrip,
  updateTripStatus,
  getDriverHistory,
  getDriverDashboard,
  submitKYC,
  getProfile,
  updateProfile,
  completeOnboarding,
  updateTelemetry,
  toggleOnlineStatus,
  getKYCDocuments,
  uploadKYCDocument,
  getPendingOffers,
  acceptOffer,
  submitCompliance,
  updatePerformance,
  rejectOffer,
  updateLocation,
  saveBankDetails
} = require('../controllers/driverController');

const router = express.Router();

router.post('/bank-details', requireAuth, saveBankDetails);
router.get('/available-loads', requireAuth, getAvailableLoads);
router.post('/apply/:bookingId', requireAuth, applyForLoad);
router.get('/active-trip', requireAuth, getActiveTrip);
router.patch('/status/:bookingId', requireAuth, updateTripStatus);
router.get('/history', requireAuth, getDriverHistory);
router.get('/dashboard', requireAuth, getDriverDashboard);
router.post('/kyc/submit', requireAuth, submitKYC);
router.get('/profile', requireAuth, getProfile);
router.put('/profile', requireAuth, updateProfile);
router.post('/onboarding/complete', requireAuth, completeOnboarding);
router.post('/trips/:bookingId/telemetry', requireAuth, updateTelemetry);
router.post('/toggle-online', requireAuth, toggleOnlineStatus);
router.post('/location', requireAuth, updateLocation);
router.get('/kyc/documents', requireAuth, getKYCDocuments);
router.post('/kyc/upload-document', requireAuth, uploadKYCDocument);

// Load Offers
router.get('/offers/pending', requireAuth, getPendingOffers);
router.post('/offers/:offerId/accept', requireAuth, acceptOffer);
router.post('/offers/:offerId/reject', requireAuth, rejectOffer);

// Compliance and Performance
router.post('/compliance', requireAuth, submitCompliance);
router.post('/performance/:bookingId', requireAuth, updatePerformance);

module.exports = router;
