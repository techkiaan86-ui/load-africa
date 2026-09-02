// Deprecated Stripe service stubbed to prevent runtime errors when replacing with Paystack.
const stripeService = {
  createPaymentIntent: async () => {
    return { success: false, message: 'Stripe is deprecated on LoadAfrica platform. Paystack gateway is active.' };
  },
  verifyWebhookSignature: () => {
    return false;
  }
};

module.exports = stripeService;
