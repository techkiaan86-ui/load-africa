const express = require('express');
const {
  getDashboard,
  getMachines,
  submitCompliance,
  addMachine,
  deleteMachine,
  acceptHireRequest,
  rejectHireRequest,
  getPublicMachines,
  getMachineOperators,
  addMachineOperator,
  deleteMachineOperator
} = require('../controllers/plantController');

const router = express.Router();

const { requireAuth } = require('../middlewares/authMiddleware');

const {
  submitApplication,
  getApplications,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
  requestChanges
} = require('../controllers/plantApplicationController');

router.get('/dashboard', requireAuth, getDashboard);
router.post('/compliance/submit', requireAuth, submitCompliance);
router.get('/machines', requireAuth, getMachines);
router.post('/machines', requireAuth, addMachine);
router.delete('/machines/:id', requireAuth, deleteMachine);
router.get('/machines/public', getPublicMachines);

// Operators
router.get('/operators', requireAuth, getMachineOperators);
router.post('/operators', requireAuth, addMachineOperator);
router.delete('/operators/:id', requireAuth, deleteMachineOperator);

router.post('/hire-requests/:requestId/accept', requireAuth, acceptHireRequest);
router.post('/hire-requests/:requestId/reject', requireAuth, rejectHireRequest);

// Application registration & approval routes
router.post('/applications', submitApplication);
router.get('/applications', getApplications);
router.get('/applications/:id', getApplicationDetails);
router.put('/applications/:id/approve', approveApplication);
router.put('/applications/:id/reject', rejectApplication);
router.put('/applications/:id/changes-requested', requestChanges);

module.exports = router;
