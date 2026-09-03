const { 
  getCustomerDashboard, 
  getMyQuotations: getMyQuotationsService,
  dismissQuotation: dismissQuotationService
} = require('../services/customerService');

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

/**
 * DELETE /api/v1/customers/my-quotations/:id
 * Customer removes/dismisses a quotation from their list.
 */
const dismissQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    await dismissQuotationService(req.user.id, id);
    res.status(200).json({ success: true, message: 'Quotation dismissed from list.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboard, getMyQuotations, dismissQuotation };
