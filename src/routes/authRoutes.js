const express = require('express');
const { register, registerDriver, login, getMe, getApprovedFleetOwnersPublic, updateProfile, changeCredentials } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/register/driver', registerDriver);
router.post('/login', login);
router.get('/me', requireAuth, getMe);
router.put('/profile', requireAuth, updateProfile);
router.put('/change-credentials', requireAuth, changeCredentials);
router.get('/fleet-owners/approved', getApprovedFleetOwnersPublic);

module.exports = router;
