const { getCustomerDashboard, getMyQuotations: getMyQuotationsService } = require('../services/customerService');

const getDashboard = async (req, res, next) => {
  try {
    const data = await getCustomerDashboard(req.user.id);
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/customers/my-quotations
 * Returns all bookings where the broker has prepared a quotation.
 * Customer can Accept or Reject each quotation.
 */
const getMyQuotations = async (req, res) => {
  try {
    const quotations = await getMyQuotationsService(req.user.id);
    res.status(200).json({ success: true, data: quotations });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboard, getMyQuotations };
