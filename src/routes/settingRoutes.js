const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

router.use(requireAuth);

// Both endpoints are admin only
router.get('/', requireRole(['ADMIN', 'SUPER_ADMIN']), settingController.getAllSettings);
router.put('/', requireRole(['ADMIN', 'SUPER_ADMIN']), settingController.updateSettings);

module.exports = router;
