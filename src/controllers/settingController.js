const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const settingController = {
  // Get all settings
  getAllSettings: async (req, res) => {
    try {
      const settings = await prisma.systemSetting.findMany();
      // Format as key-value pair for easier frontend usage
      const settingsMap = {
        PLATFORM_FEE_PCT: '10.00',
        FLEET_PAYOUT_PCT: '70.00',
        DRIVER_PAYOUT_PCT: '20.00',
        RATE_LIGHT_DUTY: '12.00',
        RATE_MEDIUM_DUTY: '18.00',
        RATE_HEAVY_DUTY: '30.00',
        RATE_REFRIGERATED: '25.00',
        RATE_WEIGHT_PER_TON: '1.50',
        RATE_FUEL_SURCHARGE_PCT: '10.00',
        RATE_TOLL_PER_100KM: '50.00',
        RATE_VAT_PCT: '15.00'
      };
      
      // Also try to read from PricingConfig if available
      try {
        const pConfig = await prisma.pricingConfig.findFirst();
        if (pConfig) {
          settingsMap.PLATFORM_FEE_PCT = String(pConfig.platform_fee_pct || '10.00');
          settingsMap.FLEET_PAYOUT_PCT = String(pConfig.fleet_payout_pct || '70.00');
          settingsMap.DRIVER_PAYOUT_PCT = String(pConfig.driver_payout_pct || '20.00');
        }
      } catch (e) {
        // Fallback to defaults
      }

      settings.forEach(s => {
        settingsMap[s.key] = s.value;
      });

      res.status(200).json({
        success: true,
        data: settingsMap
      });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  },

  // Update multiple settings at once
  updateSettings: async (req, res) => {
    try {
      const updates = req.body; // Expecting an object like { GOOGLE_MAPS_KEY: '...', PLATFORM_FEE_PCT: '10' }

      // Validate payment percentage allocation if provided
      if (
        updates.PLATFORM_FEE_PCT !== undefined ||
        updates.FLEET_PAYOUT_PCT !== undefined ||
        updates.DRIVER_PAYOUT_PCT !== undefined
      ) {
        const platform = Number(updates.PLATFORM_FEE_PCT ?? 10);
        const fleet = Number(updates.FLEET_PAYOUT_PCT ?? 70);
        const driver = Number(updates.DRIVER_PAYOUT_PCT ?? 20);

        if (isNaN(platform) || isNaN(fleet) || isNaN(driver)) {
          return res.status(400).json({ success: false, message: 'Percentage values must be valid numbers.' });
        }

        if (platform < 0 || fleet < 0 || driver < 0) {
          return res.status(400).json({ success: false, message: 'Percentages cannot be negative.' });
        }

        const total = platform + fleet + driver;
        if (Math.abs(total - 100) > 0.01) {
          return res.status(400).json({
            success: false,
            message: `Invalid percentage allocation. Total allocation must equal 100% (Current total: ${total.toFixed(2)}%).`
          });
        }

        // Sync with PricingConfig table
        try {
          const firstConfig = await prisma.pricingConfig.findFirst();
          if (firstConfig) {
            await prisma.pricingConfig.update({
              where: { id: firstConfig.id },
              data: {
                platform_fee_pct: platform,
                fleet_payout_pct: fleet,
                driver_payout_pct: driver
              }
            });
          }
        } catch (pcErr) {
          // Logged gracefully
        }

        // Log financial percentage update in ActivityLog
        try {
          let actorId = null;
          if (req.user?.id) {
            const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
            if (dbUser) actorId = req.user.id;
          }
          await prisma.activityLog.create({
            data: {
              user_id: actorId,
              action: 'PAYMENT_PERCENTAGE_UPDATED',
              description: `Payment allocation updated: Platform=${platform}%, Fleet=${fleet}%, Driver=${driver}%`
            }
          });
        } catch (logErr) {
          // Logged gracefully
        }
      }

      const updatePromises = Object.keys(updates).map(key => {
        return prisma.systemSetting.upsert({
          where: { key: key },
          update: { value: String(updates[key]) },
          create: { key: key, value: String(updates[key]) }
        });
      });

      await Promise.all(updatePromises);

      res.status(200).json({
        success: true,
        message: 'Settings updated successfully'
      });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
};

module.exports = settingController;
