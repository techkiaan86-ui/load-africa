const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_paystack_secret';
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'ZAR';

const paystackService = {
  /**
   * Initializes a Paystack transaction for customer booking checkout.
   */
  initializePayment: async ({ email, amount, reference, callbackUrl, metadata = {} }) => {
    // Development / Mock fallback if secret key is mock
    if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('mock')) {
      return {
        success: true,
        authorizationUrl: `http://localhost:5173/customer/payment/${metadata.bookingId}?mock_paystack=true&reference=${reference}`,
        accessCode: `access_mock_${Date.now()}`,
        reference,
        isMock: true
      };
    }

    try {
      const payload = {
        email,
        amount: Math.round(Number(amount) * 100), // Convert to smallest currency unit (kobo/cents)
        currency: PAYSTACK_CURRENCY.toUpperCase(),
        reference,
        callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL || 'http://localhost:5173/customer/booking-history',
        metadata
      };

      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data && data.status) {
        return {
          success: true,
          authorizationUrl: data.data.authorization_url,
          accessCode: data.data.access_code,
          reference: data.data.reference
        };
      } else {
        return { success: false, message: data.message || 'Failed to initialize Paystack payment' };
      }
    } catch (error) {
      console.error('Paystack Initialize Payment Error:', error.message);
      return {
        success: false,
        message: error.message || 'Error communicating with Paystack API'
      };
    }
  },

  /**
   * Verifies a Paystack transaction by reference from Paystack servers.
   */
  verifyPayment: async (reference) => {
    // Development / Mock fallback if secret key is mock or reference is explicitly PAY-MOCK
    if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('mock') || reference.startsWith('PAY-MOCK')) {
      return {
        success: true,
        status: 'success',
        amount: null, // Will match expected in fallback
        reference,
        channel: 'card',
        isMock: true
      };
    }

    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      });

      const data = await response.json();

      if (data && data.status && data.data.status === 'success') {
        const txnData = data.data;
        return {
          success: true,
          status: txnData.status,
          amount: txnData.amount / 100, // Convert back to standard currency units
          currency: txnData.currency,
          reference: txnData.reference,
          channel: txnData.channel,
          metadata: txnData.metadata
        };
      } else {
        return {
          success: false,
          status: data?.data?.status || 'failed',
          message: data?.message || 'Payment verification failed at Paystack'
        };
      }
    } catch (error) {
      console.error('Paystack Verify Payment Error:', error.message);
      return {
        success: false,
        message: error.message || 'Error verifying Paystack transaction'
      };
    }
  },

  /**
   * Validates Paystack webhook HMAC SHA-512 signature.
   */
  verifyWebhookSignature: (body, signature) => {
    if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('mock')) {
      return true; // Bypass signature check during mock mode
    }

    if (!signature) return false;

    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');

    return hash === signature;
  }
};

module.exports = paystackService;
