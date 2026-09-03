const express = require('express');
const { getDashboard, getMyQuotations, dismissQuotation } = require('../controllers/customerController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Apply auth and role middleware to all routes in this file
router.use(requireAuth);
router.use(requireRole(['CUSTOMER']));

router.get('/dashboard', getDashboard);
router.get('/my-quotations', getMyQuotations);
router.delete('/my-quotations/:id', dismissQuotation);

module.exports = router;
