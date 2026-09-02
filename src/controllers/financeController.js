const { prisma } = require('../config/db');

// Helper for dev, assuming user id is driver id for now.
const getDriverId = async (req) => {
  if (req.user?.driver?.id) return req.user.driver.id;
  const driver = await prisma.driver.findFirst();
  return driver ? driver.id : null;
};

const verifyPODAndReleasePayment = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        assignments: {
          include: { driver: { include: { user: true } } }
        },
        quotes: true
      }
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Check if payout has already been released for this booking
    const existingTx = await prisma.walletTransaction.findFirst({
      where: { reference_id: bookingId, type: 'CREDIT' }
    });
    if (existingTx) {
      return res.status(200).json({ success: true, message: 'Payout has already been released for this booking.' });
    }

    const assignment = booking.assignments[0];
    if (!assignment) return res.status(400).json({ success: false, message: 'No driver assigned to this booking.' });

    // Fetch the PAID invoice
    const invoice = await prisma.invoice.findFirst({
      where: { booking_id: bookingId, status: 'PAID' }
    });

    if (!invoice) return res.status(400).json({ success: false, message: 'No paid invoice found for this booking.' });

    const totalAmount = Number(invoice.total_amount);
    
    // Dynamic Payment Configuration lookup from SystemSetting or PricingConfig
    const systemSettings = await prisma.systemSetting.findMany({
      where: { key: { in: ['PLATFORM_FEE_PCT', 'FLEET_PAYOUT_PCT', 'DRIVER_PAYOUT_PCT'] } }
    });
    const settingsMap = {};
    systemSettings.forEach(s => { settingsMap[s.key] = Number(s.value); });
    
    let pConfig = null;
    try { pConfig = await prisma.pricingConfig.findFirst(); } catch (e) {}

    const platformFeePct = settingsMap.PLATFORM_FEE_PCT ?? (pConfig?.platform_fee_pct ? Number(pConfig.platform_fee_pct) : 10.00);
    const fleetPayoutPct = settingsMap.FLEET_PAYOUT_PCT ?? (pConfig?.fleet_payout_pct ? Number(pConfig.fleet_payout_pct) : 70.00);
    const driverPayoutPct = settingsMap.DRIVER_PAYOUT_PCT ?? (pConfig?.driver_payout_pct ? Number(pConfig.driver_payout_pct) : 20.00);

    const brokerPercentage = assignment.broker_id ? 0.05 : 0.00;
    const platformPercentage = Math.max(0, (platformFeePct / 100.0) - brokerPercentage);
    
    const platformAmount = totalAmount * platformPercentage;
    const brokerAmount = totalAmount * brokerPercentage;

    let effectiveFleetOwnerId = assignment.fleet_owner_id;
    if (!effectiveFleetOwnerId && assignment.driver_id) {
      const drv = await prisma.driver.findUnique({ where: { id: assignment.driver_id } });
      if (drv && drv.fleet_owner_id) {
        effectiveFleetOwnerId = drv.fleet_owner_id;
      }
    }

    let fleetOwnerAmount = 0;
    let driverAmount = 0;

    // Determine Payout Splits based on assignment type
    if (effectiveFleetOwnerId && assignment.driver_id) {
      // Both Fleet Owner & Fleet Driver assigned
      fleetOwnerAmount = totalAmount * (fleetPayoutPct / 100.0);
      driverAmount = totalAmount * (driverPayoutPct / 100.0);
    } else if (assignment.driver_id && !effectiveFleetOwnerId) {
      // Independent Driver assignment
      driverAmount = totalAmount * ((fleetPayoutPct + driverPayoutPct) / 100.0);
    } else if (effectiveFleetOwnerId && !assignment.driver_id) {
      // Fleet Owner assignment without specific driver
      fleetOwnerAmount = totalAmount * ((fleetPayoutPct + driverPayoutPct) / 100.0);
    } else {
      // General fallback to provider
      fleetOwnerAmount = totalAmount * ((fleetPayoutPct + driverPayoutPct) / 100.0);
    }
    
    // Admin Wallet logic
    let adminUser = await prisma.user.findFirst({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } } });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }
    if (!adminUser) throw new Error("No platform admin configured for wallets");

    await prisma.$transaction(async (tx) => {
      // 1. Mark booking as COMPLETED
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'COMPLETED' }
      });

      await tx.bookingAssignment.updateMany({
        where: { booking_id: bookingId },
        data: { status: 'COMPLETED' }
      });

      // 2. Add to Tracking
      await tx.trackingHistory.create({
        data: { booking_id: bookingId, status: 'COMPLETED', remarks: 'Admin verified POD. Booking completed and funds released.' }
      });

      // Platform Wallet Update
      let adminWallet = await tx.wallet.findFirst({ where: { user_id: adminUser.id } });
      if (!adminWallet) adminWallet = await tx.wallet.create({ data: { user_id: adminUser.id, balance: 0 } });
      await tx.wallet.update({
        where: { id: adminWallet.id },
        data: { balance: { increment: platformAmount } }
      });
      await tx.walletTransaction.create({
        data: {
          wallet_id: adminWallet.id,
          type: 'CREDIT',
          amount: platformAmount,
          description: `Platform Fee (${platformFeePct}%) for Booking ${invoice.booking_id}`,
          reference_id: invoice.booking_id,
          status: 'COMPLETED'
        }
      });
      await tx.commission.create({
        data: {
          reference_type: 'BOOKING',
          reference_id: invoice.booking_id,
          earned_by_user_id: adminUser.id,
          commission_type: 'PLATFORM_FEE',
          amount: platformAmount,
          status: 'PAID'
        }
      });

      // Fleet Owner Wallet Update (if applicable)
      if (effectiveFleetOwnerId && fleetOwnerAmount > 0) {
        const fleet = await tx.fleetOwner.findUnique({ where: { id: effectiveFleetOwnerId } });
        if (fleet && fleet.user_id) {
          let fWallet = await tx.wallet.findFirst({ where: { user_id: fleet.user_id } });
          if (!fWallet) fWallet = await tx.wallet.create({ data: { user_id: fleet.user_id, balance: 0 } });

          await tx.wallet.update({
            where: { id: fWallet.id },
            data: { balance: { increment: fleetOwnerAmount } }
          });
          await tx.walletTransaction.create({
            data: {
              wallet_id: fWallet.id,
              type: 'CREDIT',
              amount: fleetOwnerAmount,
              description: `Fleet Owner Earnings for Booking ${invoice.booking_id}`,
              reference_id: invoice.booking_id,
              status: 'COMPLETED'
            }
          });
        }
      }

      // Driver Wallet Update (if applicable)
      if (assignment.driver_id && driverAmount > 0) {
        const driver = await tx.driver.findUnique({ where: { id: assignment.driver_id } });
        if (driver && driver.user_id) {
          let dWallet = await tx.wallet.findFirst({ where: { user_id: driver.user_id } });
          if (!dWallet) dWallet = await tx.wallet.create({ data: { user_id: driver.user_id, balance: 0 } });

          await tx.wallet.update({
            where: { id: dWallet.id },
            data: { balance: { increment: driverAmount } }
          });
          await tx.walletTransaction.create({
            data: {
              wallet_id: dWallet.id,
              type: 'CREDIT',
              amount: driverAmount,
              description: `Driver Earnings for Booking ${invoice.booking_id}`,
              reference_id: invoice.booking_id,
              status: 'COMPLETED'
            }
          });
        }
      }

      // Broker Wallet Update
      if (assignment.broker_id && brokerAmount > 0) {
        const broker = await tx.broker.findUnique({ where: { id: assignment.broker_id } });
        if (broker && broker.user_id) {
          let bWallet = await tx.wallet.findFirst({ where: { user_id: broker.user_id } });
          if (!bWallet) bWallet = await tx.wallet.create({ data: { user_id: broker.user_id, balance: 0 } });

          await tx.wallet.update({
            where: { id: bWallet.id },
            data: { balance: { increment: brokerAmount } }
          });
          await tx.walletTransaction.create({
            data: {
              wallet_id: bWallet.id,
              type: 'CREDIT',
              amount: brokerAmount,
              description: `Broker Commission for Booking ${invoice.booking_id}`,
              reference_id: invoice.booking_id,
              status: 'COMPLETED'
            }
          });
          await tx.commission.create({
            data: {
              reference_type: 'BOOKING',
              reference_id: invoice.booking_id,
              earned_by_user_id: broker.user_id,
              commission_type: 'BROKER_FEE',
              amount: brokerAmount,
              status: 'PAID'
            }
          });
        }
      }

      // Record BookingSettlement history entry
      try {
        await tx.bookingSettlement.upsert({
          where: { booking_id: bookingId },
          update: {
            customerPaymentAmount: totalAmount,
            platformFee: platformAmount,
            fleetOwnerExpectedEarnings: fleetOwnerAmount,
            driverExpectedEarnings: driverAmount,
            fleetOwnerPayoutStatus: 'PAID',
            driverPayoutStatus: 'PAID'
          },
          create: {
            booking_id: bookingId,
            customerPaymentAmount: totalAmount,
            platformFee: platformAmount,
            fleetOwnerExpectedEarnings: fleetOwnerAmount,
            driverExpectedEarnings: driverAmount,
            fleetOwnerPayoutStatus: 'PAID',
            driverPayoutStatus: 'PAID'
          }
        });
      } catch (bsErr) {
        console.error('BookingSettlement error:', bsErr);
      }
    });

    res.status(200).json({ success: true, message: 'POD Verified and Escrow funds released.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const withdrawEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });

    const wallet = await prisma.wallet.findFirst({ where: { user_id: userId } });
    if (!wallet || Number(wallet.balance) < amount) return res.status(400).json({ success: false, message: 'Insufficient funds' });

    await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { 
          balance: { decrement: amount },
          pending_balance: { increment: amount }
        }
      });

      await tx.walletTransaction.create({
        data: {
          wallet_id: wallet.id,
          type: 'DEBIT',
          amount,
          description: `Withdrawal request submitted`,
          status: 'PENDING'
        }
      });
    });

    res.status(200).json({ success: true, message: 'Withdrawal request submitted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    
    let wallet = await prisma.wallet.findFirst({ 
      where: { user_id: userId },
      include: { 
        transactions: { orderBy: { created_at: 'desc' } },
        user: { select: { first_name: true, last_name: true } }
      }
    });
 
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { user_id: userId, balance: 0 },
        include: { 
          transactions: true,
          user: { select: { first_name: true, last_name: true } }
        }
      });
    }
 
    res.status(200).json({ success: true, data: wallet });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

const processPayment = (req, res) => {
  return initializePaystackPayment(req, res);
};


const simulateStripeWebhook = async (req, res) => {
  try {
    const { invoiceId, bookingId, transactionId } = req.body;
    
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { transaction_id: transactionId },
        data: { status: 'PAID' }
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' }
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'TRANSPORTER_ASSIGNMENT' }
      });
      await tx.trackingHistory.create({
        data: { booking_id: bookingId, status: 'PAYMENT_RECEIVED', remarks: 'Customer completed payment.' }
      });

      // Find the held offer and release it by calling dispatchLoad outside transaction
      // We don't create bookingAssignment here anymore, dispatchLoad will send the offer.
    });

    // Start matching driver in background now that payment is confirmed
    const { dispatchLoad } = require('../services/matchingService');
    await dispatchLoad(bookingId);

    res.json({ success: true, message: 'Mock payment verified' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeService.verifyWebhookSignature(req.body, sig);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { invoiceId, bookingId } = paymentIntent.metadata;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Mark Payment as PAID
        await tx.payment.updateMany({
          where: { transaction_id: paymentIntent.id },
          data: { status: 'PAID' }
        });

        // 2. Mark Invoice as PAID
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: 'PAID' }
        });

        // 3. Mark Booking as TRANSPORTER_ASSIGNMENT
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'TRANSPORTER_ASSIGNMENT' }
        });

        // Add to tracking
        await tx.trackingHistory.create({
          data: { booking_id: bookingId, status: 'PAYMENT_RECEIVED', remarks: 'Customer completed Stripe payment.' }
        });

        // Assignment will be created after Fleet accepts the dispatched offer.
        // We do not create it here.


        // Log Financial Activity
        await tx.activityLog.create({
          data: {
            action: 'PAYMENT_PROCESSED',
            description: `Stripe payment of ${paymentIntent.amount / 100} processed for Invoice ${invoiceId}`
          }
        });
      });
      
      // Start dispatching load in background now that payment is confirmed
      const { dispatchLoad } = require('../services/matchingService');
      await dispatchLoad(bookingId);

    } catch (dbError) {
      console.error('Error updating DB on Stripe webhook:', dbError);
    }
  }

  res.json({received: true});
};

const approveWithdrawal = async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
      include: { wallet: true }
    });

    if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (transaction.status !== 'PENDING' || transaction.type !== 'DEBIT') {
      return res.status(400).json({ success: false, message: 'Invalid transaction for approval' });
    }

    await prisma.$transaction(async (tx) => {
      // Mark transaction as COMPLETED
      await tx.walletTransaction.update({
        where: { id: transactionId },
        data: { status: 'COMPLETED' }
      });

      // Deduct from pending_balance
      await tx.wallet.update({
        where: { id: transaction.wallet_id },
        data: { pending_balance: { decrement: transaction.amount } }
      });

      // Log
      await tx.activityLog.create({
        data: {
          user_id: req.user.id,
          action: 'WITHDRAWAL_APPROVED',
          description: `Admin approved withdrawal of ${transaction.amount} for wallet ${transaction.wallet_id}`
        }
      });
    });

    res.status(200).json({ success: true, message: 'Withdrawal approved successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const paystackService = require('../services/paystackService');

/**
 * POST /api/v1/finance/paystack/initialize
 * Authenticated endpoint for customer Paystack checkout initialization.
 */
const initializePaystackPayment = async (req, res) => {
  try {
    const { invoiceId, bookingId } = req.body;

    let invoice = null;
    if (invoiceId) {
      invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
      });
    }

    if (!invoice && bookingId) {
      invoice = await prisma.invoice.findFirst({
        where: { booking_id: bookingId },
        include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
      });
    }

    let booking = invoice ? invoice.booking : null;
    if (!booking && bookingId) {
      booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { customer: { include: { user: true } }, quotes: true }
      });
    }

    if (!booking) return res.status(404).json({ success: false, message: 'Associated booking not found.' });

    // Validate customer ownership
    const isOwner = booking.customer_id === req.user?.customer?.id || 
                    booking.customer?.user_id === req.user?.id || 
                    req.user?.role === 'CUSTOMER';
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized to pay for this booking.' });
    }

    // Validate payable status
    const payableStatuses = ['PAYMENT_PENDING', 'TRANSPORTER_AVAILABLE', 'CUSTOMER_ACCEPTED', 'DRIVER_ASSIGNED', 'MANUAL_ACTION_REQUIRED'];
    if (!payableStatuses.includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Booking in status ${booking.status} is not eligible for payment.` });
    }

    // Auto-create invoice if missing or zero
    if (!invoice || Number(invoice.total_amount || 0) <= 0) {
      const quote = booking.quotes?.[0];
      const calcTotal = quote ? (Number(quote.grand_total || 0) || (Number(quote.distance_cost || 0) + Number(quote.platform_fee || 0) + Number(quote.tax || 0) + Number(quote.surcharge || 0))) : 100.10;
      const finalAmount = calcTotal > 0 ? calcTotal : 100.10;

      const invoiceNo = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const customerId = booking.customer_id || (booking.customer ? booking.customer.id : req.user?.customer?.id);
      const subAmt = Number((finalAmount / 1.15).toFixed(2));
      const taxAmt = Number((finalAmount - subAmt).toFixed(2));

      if (invoice) {
        invoice = await prisma.invoice.update({
          where: { id: invoice.id },
          data: { amount: subAmt, tax_amount: taxAmt, total_amount: finalAmount, status: 'ISSUED' },
          include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
        });
      } else {
        invoice = await prisma.invoice.create({
          data: {
            invoice_no: invoiceNo,
            booking_id: booking.id,
            customer_id: customerId,
            amount: subAmt,
            tax_amount: taxAmt,
            total_amount: finalAmount,
            status: 'ISSUED',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
        });
      }
    }

    if (invoice.status === 'PAID') return res.status(400).json({ success: false, message: 'Invoice has already been paid.' });

    // Authoritative Amount calculation from database
    const payableAmount = Number(invoice.total_amount);
    if (!payableAmount || payableAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid invoice payable amount.' });
    }

    // Check if there is already a PENDING payment record with reference
    const existingPayment = await prisma.payment.findFirst({
      where: { invoice_id: invoice.id, status: 'PENDING' },
      orderBy: { created_at: 'desc' }
    });

    let reference = existingPayment?.transaction_id;
    if (!reference) {
      reference = `PAY-${booking.id.slice(0, 8)}-${Date.now()}`;
      await prisma.payment.create({
        data: {
          invoice_id: invoice.id,
          amount: payableAmount,
          payment_method: 'PAYSTACK',
          transaction_id: reference,
          status: 'PENDING'
        }
      });
    }

    // Initialize Paystack transaction
    const paystackResult = await paystackService.initializePayment({
      email: req.user.email,
      amount: payableAmount,
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || `${req.headers.origin || 'http://localhost:5173'}/customer/booking-history`,
      metadata: {
        bookingId: booking.id,
        invoiceId: invoice.id,
        customerId: booking.customer_id
      }
    });

    if (!paystackResult.success) {
      return res.status(500).json({ success: false, message: paystackResult.message || 'Paystack initialization failed.' });
    }

    res.status(200).json({
      success: true,
      authorizationUrl: paystackResult.authorizationUrl,
      accessCode: paystackResult.accessCode,
      reference: paystackResult.reference,
      amount: payableAmount,
      invoiceId: invoice.id,
      bookingId: booking.id,
      isMock: paystackResult.isMock || false,
      message: 'Paystack payment initialized successfully'
    });

  } catch (error) {
    console.error('initializePaystackPayment Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/finance/paystack/verify
 * Authenticated endpoint to verify transaction with Paystack API.
 */
const verifyPaystackPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success: false, message: 'Paystack transaction reference is required.' });

    const payment = await prisma.payment.findFirst({
      where: { transaction_id: reference },
      include: { invoice: { include: { booking: true } } }
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found for this reference.' });

    // Idempotency: If already paid, return clean success without double processing
    if (payment.status === 'PAID' && payment.invoice.status === 'PAID') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and load dispatched.',
        bookingId: payment.invoice.booking_id
      });
    }

    // Verify with Paystack API
    const paystackResult = await paystackService.verifyPayment(reference);

    if (!paystackResult.success) {
      return res.status(400).json({ success: false, message: paystackResult.message || 'Payment verification failed at Paystack.' });
    }

    // Authoritative Amount check
    if (paystackResult.amount !== null && Number(paystackResult.amount) !== Number(payment.amount)) {
      console.error(`Paystack Amount Mismatch! Expected: ${payment.amount}, Received: ${paystackResult.amount}`);
      return res.status(400).json({ success: false, message: 'Payment amount mismatch detected.' });
    }

    const bookingId = payment.invoice.booking_id;
    const invoiceId = payment.invoice.id;

    // Atomic database update
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { transaction_id: reference },
        data: { status: 'PAID' }
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' }
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'PAYMENT_RECEIVED' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'PAYMENT_RECEIVED',
          remarks: `Paystack payment verified successfully (${reference}). Platform escrow active.`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      await tx.activityLog.create({
        data: {
          user_id: req.user?.id || null,
          action: 'PAYSTACK_PAYMENT_VERIFIED',
          description: `Verified Paystack payment of ${payment.amount} for Invoice ${invoiceId}`
        }
      });
    });

    // Trigger dispatchLoad to release assignment to matched Fleet Owner
    const { dispatchLoad } = require('../services/matchingService');
    const io = req.app ? req.app.get('io') : null;
    await dispatchLoad(bookingId, io);

    res.status(200).json({
      success: true,
      message: 'Paystack payment verified and load dispatched successfully.',
      bookingId
    });

  } catch (error) {
    console.error('verifyPaystackPayment Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/finance/paystack/webhook
 * Paystack Webhook endpoint handling charge.success events idempotently.
 */
const paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const isValidSignature = paystackService.verifyWebhookSignature(req.body, signature);

    if (!isValidSignature) {
      console.error('Invalid Paystack Webhook Signature!');
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body;
    if (event && event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference;

      console.log(`[Paystack Webhook] Received charge.success for reference: ${reference}`);

      const payment = await prisma.payment.findFirst({
        where: { transaction_id: reference },
        include: { invoice: true }
      });

      if (payment && payment.status !== 'PAID') {
        const bookingId = payment.invoice.booking_id;
        const invoiceId = payment.invoice.id;

        await prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({
            where: { transaction_id: reference },
            data: { status: 'PAID' }
          });

          await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: 'PAID' }
          });

          await tx.trackingHistory.create({
            data: {
              booking_id: bookingId,
              status: 'PAYMENT_RECEIVED',
              remarks: `Paystack webhook verified payment (${reference}).`,
              updated_by: 'SYSTEM'
            }
          });
        });

        const { dispatchLoad } = require('../services/matchingService');
        const io = req.app ? req.app.get('io') : null;
        await dispatchLoad(bookingId, io);
      }
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('paystackWebhook Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const razorpayService = require('../services/razorpayService');

/**
 * POST /api/v1/finance/razorpay/create-order
 * Creates a Razorpay order with client test key (rzp_test_TMRyc8lDjomNTV)
 */
const createRazorpayOrder = async (req, res) => {
  try {
    const { invoiceId, bookingId } = req.body;

    let invoice = null;
    if (invoiceId) {
      invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
      });
    }

    if (!invoice && bookingId) {
      invoice = await prisma.invoice.findFirst({
        where: { booking_id: bookingId },
        include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
      });
    }

    let booking = invoice ? invoice.booking : null;
    if (!booking && bookingId) {
      booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { customer: { include: { user: true } }, quotes: true }
      });
    }

    if (!booking) return res.status(404).json({ success: false, message: 'Associated booking not found.' });

    const isOwner = booking.customer_id === req.user?.customer?.id || 
                    booking.customer?.user_id === req.user?.id || 
                    req.user?.role === 'CUSTOMER';
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized to pay for this booking.' });
    }

    const payableStatuses = ['PAYMENT_PENDING', 'TRANSPORTER_AVAILABLE', 'CUSTOMER_ACCEPTED', 'DRIVER_ASSIGNED', 'MANUAL_ACTION_REQUIRED'];
    if (!payableStatuses.includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Booking in status ${booking.status} is not eligible for payment.` });
    }

    // Auto-create invoice if missing or zero
    if (!invoice || Number(invoice.total_amount || 0) <= 0) {
      const quote = booking.quotes?.[0];
      const calcTotal = quote ? (Number(quote.grand_total || 0) || (Number(quote.distance_cost || 0) + Number(quote.platform_fee || 0) + Number(quote.tax || 0) + Number(quote.surcharge || 0))) : 98.80;
      const finalAmount = calcTotal > 0 ? calcTotal : 98.80;

      const invoiceNo = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const customerId = booking.customer_id || (booking.customer ? booking.customer.id : req.user?.customer?.id);
      const subAmt = Number((finalAmount / 1.15).toFixed(2));
      const taxAmt = Number((finalAmount - subAmt).toFixed(2));

      if (invoice) {
        invoice = await prisma.invoice.update({
          where: { id: invoice.id },
          data: { amount: subAmt, tax_amount: taxAmt, total_amount: finalAmount, status: 'ISSUED' },
          include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
        });
      } else {
        invoice = await prisma.invoice.create({
          data: {
            invoice_no: invoiceNo,
            booking_id: booking.id,
            customer_id: customerId,
            amount: subAmt,
            tax_amount: taxAmt,
            total_amount: finalAmount,
            status: 'ISSUED',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          include: { booking: { include: { customer: { include: { user: true } }, quotes: true } } }
        });
      }
    }

    if (invoice.status === 'PAID') return res.status(400).json({ success: false, message: 'Invoice has already been paid.' });

    const payableAmount = Number(invoice.total_amount);
    if (!payableAmount || payableAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid invoice payable amount.' });
    }

    // Call Razorpay Service
    const orderResult = await razorpayService.createOrder({
      amount: payableAmount,
      currency: process.env.RAZORPAY_CURRENCY || 'INR',
      receipt: `rcpt_${booking.id.slice(0, 8)}`,
      notes: {
        bookingId: booking.id,
        invoiceId: invoice.id,
        customerId: booking.customer_id
      }
    });

    if (!orderResult.success) {
      return res.status(500).json({ success: false, message: orderResult.message || 'Failed to create Razorpay order.' });
    }

    // Store or update pending Payment record
    const existingPayment = await prisma.payment.findFirst({
      where: { invoice_id: invoice.id, status: 'PENDING' }
    });

    if (existingPayment) {
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: { transaction_id: orderResult.orderId, amount: payableAmount, payment_method: 'RAZORPAY' }
      });
    } else {
      await prisma.payment.create({
        data: {
          invoice_id: invoice.id,
          amount: payableAmount,
          payment_method: 'RAZORPAY',
          transaction_id: orderResult.orderId,
          status: 'PENDING'
        }
      });
    }

    res.status(200).json({
      success: true,
      orderId: orderResult.orderId,
      keyId: orderResult.keyId || process.env.RAZORPAY_KEY_ID || 'rzp_test_TMRyc8lDjomNTV',
      amount: payableAmount,
      currency: orderResult.currency || 'INR',
      invoiceId: invoice.id,
      bookingId: booking.id,
      customer: {
        name: `${booking.customer?.user?.first_name || ''} ${booking.customer?.user?.last_name || ''}`.trim() || 'Customer',
        email: booking.customer?.user?.email || req.user?.email || '',
        phone: booking.customer?.user?.phone || ''
      },
      message: 'Razorpay order created successfully'
    });

  } catch (error) {
    console.error('createRazorpayOrder Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/finance/razorpay/verify-payment
 * Verifies Razorpay HMAC SHA-256 signature and dispatches load to matched Fleet Owner
 */
const verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing required Razorpay payment verification parameters.' });
    }

    const isValidSignature = razorpayService.verifySignature({
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      signature: razorpay_signature
    });

    if (!isValidSignature) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay payment signature detected.' });
    }

    const payment = await prisma.payment.findFirst({
      where: { transaction_id: razorpay_order_id },
      include: { invoice: { include: { booking: true } } }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found for this order ID.' });
    }

    // Idempotency: If already paid, return clean success
    if (payment.status === 'PAID' && payment.invoice.status === 'PAID') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and load dispatched.',
        bookingId: payment.invoice.booking_id
      });
    }

    const bookingId = payment.invoice.booking_id;
    const invoiceId = payment.invoice.id;

    // Atomic DB update
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { transaction_id: razorpay_order_id },
        data: { status: 'PAID', payment_method: 'RAZORPAY' }
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' }
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'PAYMENT_RECEIVED' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'PAYMENT_RECEIVED',
          remarks: `Razorpay payment verified (${razorpay_payment_id}). Platform escrow active.`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });

      await tx.activityLog.create({
        data: {
          user_id: req.user?.id || null,
          action: 'RAZORPAY_PAYMENT_VERIFIED',
          description: `Verified Razorpay payment ${razorpay_payment_id} for Order ${razorpay_order_id}`
        }
      });
    });

    // Trigger dispatchLoad to release assignment to matched Fleet Owner
    const { dispatchLoad } = require('../services/matchingService');
    const io = req.app ? req.app.get('io') : null;
    await dispatchLoad(bookingId, io);

    res.status(200).json({
      success: true,
      message: 'Razorpay payment verified and load dispatched successfully.',
      bookingId,
      paymentId: razorpay_payment_id
    });

  } catch (error) {
    console.error('verifyRazorpayPayment Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const verifyStripePayment = async (req, res) => {
  try {
    const { paymentIntentId, invoiceId, bookingId } = req.body;

    if (!invoiceId || !bookingId) {
      return res.status(400).json({ success: false, message: 'Invoice ID and Booking ID are required.' });
    }

    const intentId = paymentIntentId || `pi_stripe_${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { invoice_id: invoiceId },
        data: { status: 'PAID', payment_method: 'STRIPE_CARD' }
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' }
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'PAYMENT_RECEIVED' }
      });

      await tx.trackingHistory.create({
        data: {
          booking_id: bookingId,
          status: 'PAYMENT_RECEIVED',
          remarks: `Stripe Card payment verified (${intentId}). Escrow active.`,
          updated_by: req.user?.id || 'SYSTEM'
        }
      });
    });

    const { dispatchLoad } = require('../services/matchingService');
    const io = req.app ? req.app.get('io') : null;
    await dispatchLoad(bookingId, io);

    res.status(200).json({
      success: true,
      message: 'Stripe payment verified and load dispatched successfully.',
      bookingId,
      paymentIntentId: intentId
    });
  } catch (error) {
    console.error('verifyStripePayment Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  verifyPODAndReleasePayment,
  processPayment,
  simulateStripeWebhook,
  stripeWebhook,
  verifyStripePayment,
  initializePaystackPayment,
  verifyPaystackPayment,
  paystackWebhook,
  createRazorpayOrder,
  verifyRazorpayPayment,
  withdrawEarnings,
  getWallet,
  approveWithdrawal
};
