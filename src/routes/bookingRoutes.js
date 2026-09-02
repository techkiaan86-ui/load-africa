const express = require('express');
const { 
  getActiveVehicleCategories,
  getQuoteRecommendations, 
  createBooking,
  getCustomerBookingsHistory,
  getBookingDetails,
  updateBookingStatus,
  getBookingTimeline,
  acceptBooking,
  rejectBooking,
  cancelBooking
} = require('../controllers/bookingController');
const { requireAuth, softAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// Fetch active vehicle categories for customer booking selection
router.get('/vehicle-categories', getActiveVehicleCategories);

// Generate quote recommendations based on distance and weight
router.post('/quote', getQuoteRecommendations);

// Booking creation — must be authenticated so it links to the customer profile
router.post('/', requireAuth, createBooking);

// New Lifecycle Routes
router.get('/history', requireAuth, getCustomerBookingsHistory);
router.get('/:id', requireAuth, getBookingDetails);
router.patch('/:id/status', requireAuth, updateBookingStatus);
router.get('/:id/timeline', requireAuth, getBookingTimeline);

// Provider Accept / Reject
router.post('/:id/accept', requireAuth, acceptBooking);
router.post('/:id/reject', requireAuth, rejectBooking);

// Customer Cancel
router.post('/:id/cancel', requireAuth, cancelBooking);

module.exports = router;
