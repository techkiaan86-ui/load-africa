const express = require('express');
const { 
  verifyPODAndReleasePayment, 
  withdrawEarnings, 
  getWallet, 
  approveWithdrawal, 
  initializePaystackPayment,
  verifyPaystackPayment,
  paystackWebhook
} = require('../controllers/financeController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/verify-pod/:bookingId', verifyPODAndReleasePayment);
router.post('/withdraw', requireAuth, withdrawEarnings);
router.get('/wallet', requireAuth, getWallet);

// Paystack Primary Payment Endpoints
router.post('/process-payment', requireAuth, initializePaystackPayment);
router.post('/paystack/initialize', requireAuth, initializePaystackPayment);
router.post('/paystack/verify', requireAuth, verifyPaystackPayment);
router.post('/paystack/webhook', paystackWebhook);

// Admin approve withdrawal
router.post('/withdraw/approve', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), approveWithdrawal);

module.exports = router;

