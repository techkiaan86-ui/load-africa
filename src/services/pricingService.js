/**
 * Enterprise Pricing Engine for Logistics
 * Simulates real-time quotation logic based on distance, weight, and vehicle category.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Default vehicle base rates (per km)
const DEFAULT_VEHICLE_RATES = {
  'Light Duty': { base_price_per_km: 12, capacity: 2000, speed_kmh: 60, badges: ['Cheapest'] },
  'Medium Duty': { base_price_per_km: 18, capacity: 8000, speed_kmh: 70, badges: ['Recommended'] },
  'Heavy Duty': { base_price_per_km: 30, capacity: 34000, speed_kmh: 80, badges: ['Fastest'] },
  'Refrigerated': { base_price_per_km: 25, capacity: 15000, speed_kmh: 65, badges: ['Premium'] },
};

/**
 * Reads real-time admin pricing rates from database
 */
const getDynamicPricingConfig = async () => {
  const config = {
    RATE_LIGHT_DUTY: 12.00,
    RATE_MEDIUM_DUTY: 18.00,
    RATE_HEAVY_DUTY: 30.00,
    RATE_REFRIGERATED: 25.00,
    RATE_WEIGHT_PER_TON: 1.50,
    RATE_FUEL_SURCHARGE_PCT: 10.00,
    RATE_TOLL_PER_100KM: 50.00,
    RATE_VAT_PCT: 15.00,
    PLATFORM_FEE_PCT: 10.00,
    FLEET_PAYOUT_PCT: 70.00,
    DRIVER_PAYOUT_PCT: 20.00
  };

  try {
    const settings = await prisma.systemSetting.findMany();
    settings.forEach(s => {
      const num = parseFloat(s.value);
      if (!isNaN(num)) config[s.key] = num;
    });

    const pConfig = await prisma.pricingConfig.findFirst();
    if (pConfig) {
      if (pConfig.platform_fee_pct) config.PLATFORM_FEE_PCT = Number(pConfig.platform_fee_pct);
      if (pConfig.fleet_payout_pct) config.FLEET_PAYOUT_PCT = Number(pConfig.fleet_payout_pct);
      if (pConfig.driver_payout_pct) config.DRIVER_PAYOUT_PCT = Number(pConfig.driver_payout_pct);
      if (pConfig.tax_rate) config.RATE_VAT_PCT = Number(pConfig.tax_rate);
    }
  } catch (e) {
    console.warn('Could not read dynamic pricing from db, using defaults');
  }

  return config;
};

const resolveVehicleCategory = (vehicleType, weightKg, customRates = {}) => {
  const rates = { ...DEFAULT_VEHICLE_RATES, ...customRates };
  if (rates[vehicleType]) return { ...rates[vehicleType], typeKey: vehicleType };

  const str = (vehicleType || '').toLowerCase();
  const normWeight = weightKg > 100 ? weightKg : weightKg * 1000;

  if (str.includes('refrigerated') || str.includes('coldroom') || str.includes('cool')) {
    return { ...rates['Refrigerated'], typeKey: 'Refrigerated' };
  }
  if (str.includes('light') || str.includes('bakkie') || str.includes('car') || str.includes('motorbike') || normWeight <= 2000) {
    return { ...rates['Light Duty'], typeKey: 'Light Duty' };
  }
  if (str.includes('heavy') || str.includes('14-ton') || str.includes('22-ton') || str.includes('34-ton') || str.includes('tipper') || str.includes('flatbed') || normWeight > 8000) {
    return { ...rates['Heavy Duty'], typeKey: 'Heavy Duty' };
  }
  return { ...rates['Medium Duty'], typeKey: 'Medium Duty' };
};

/**
 * Calculates a detailed quote for a given distance, weight, and vehicle.
 */
const calculateDetailedQuote = (distanceKm, weightKg, vehicleType, requirements = [], ratesConfig = {}) => {
  const customRates = ratesConfig.vehicleRates || {};
  const vehicle = resolveVehicleCategory(vehicleType, weightKg, customRates);
  if (!vehicle) throw new Error('Invalid vehicle type for quotation');

  const normWeightKg = weightKg > 100 ? weightKg : weightKg * 1000;

  const perKmRate = ratesConfig.perKmRate !== undefined ? Number(ratesConfig.perKmRate) : vehicle.base_price_per_km;
  const weightRate = ratesConfig.weightRate !== undefined ? Number(ratesConfig.weightRate) : 1.5;
  const fuelPct = ratesConfig.fuelPct !== undefined ? Number(ratesConfig.fuelPct) / 100 : 0.10;
  const tollRate = ratesConfig.tollRate !== undefined ? Number(ratesConfig.tollRate) : 50;
  const platformFeePct = ratesConfig.platformFeePct !== undefined ? Number(ratesConfig.platformFeePct) / 100 : 0.08;
  const vatPct = ratesConfig.vatPct !== undefined ? Number(ratesConfig.vatPct) / 100 : 0.15;

  const baseFare = distanceKm * perKmRate;
  const weightCharge = (normWeightKg / 1000) * weightRate; // per ton
  
  // Fuel Surcharge
  const fuelSurcharge = baseFare * fuelPct;
  
  // Tolls (simulated: 1 toll every 100km)
  const tollCharges = Math.floor(distanceKm / 100) * tollRate;

  // Extra Requirements
  let insuranceCharge = 0;
  if (requirements.includes('INSURANCE')) {
    insuranceCharge = (baseFare + weightCharge) * 0.05; // 5% of subtotal
  }

  const subtotal = baseFare + weightCharge + fuelSurcharge + tollCharges + insuranceCharge;
  const platformFee = subtotal * platformFeePct;
  
  const tax = (subtotal + platformFee) * vatPct; // VAT
  const discount = 0;

  const grandTotal = subtotal + platformFee + tax - discount;

  // Calculate ETA (simple duration)
  const durationHours = distanceKm / vehicle.speed_kmh;
  const deliveryTime = new Date();
  deliveryTime.setHours(deliveryTime.getHours() + durationHours);

  return {
    vehicle_type: vehicleType,
    capacity_kg: vehicle.capacity,
    eta_hours: durationHours.toFixed(1),
    estimated_delivery: deliveryTime,
    badges: vehicle.badges,
    breakdown: {
      distance_km: distanceKm,
      base_fare: parseFloat(baseFare.toFixed(2)),
      weight_charges: parseFloat(weightCharge.toFixed(2)),
      fuel_surcharge: parseFloat(fuelSurcharge.toFixed(2)),
      toll_charges: parseFloat(tollCharges.toFixed(2)),
      insurance: parseFloat(insuranceCharge.toFixed(2)),
      platform_fee: parseFloat(platformFee.toFixed(2)),
      tax: parseFloat(tax.toFixed(2)),
      discount: parseFloat(discount.toFixed(2)),
      grand_total: parseFloat(grandTotal.toFixed(2))
    }
  };
};

/**
 * Recommends available vehicles for a given route and weight.
 */
const recommendVehicles = (distanceKm, weightKg, requirements = [], ratesConfig = {}) => {
  const options = [];

  for (const [type, specs] of Object.entries(DEFAULT_VEHICLE_RATES)) {
    const normWeight = weightKg > 100 ? weightKg : weightKg * 1000;
    // Skip vehicles that can't carry the weight
    if (normWeight > specs.capacity) continue;
    
    // If temperature controlled is required, only show Refrigerated
    if (requirements.includes('TEMPERATURE_CONTROL') && type !== 'Refrigerated') continue;

    const quote = calculateDetailedQuote(distanceKm, weightKg, type, requirements, ratesConfig);
    options.push(quote);
  }

  // Sort by cheapest grand total by default
  return options.sort((a, b) => a.breakdown.grand_total - b.breakdown.grand_total);
};

module.exports = {
  calculateDetailedQuote,
  recommendVehicles,
  getDynamicPricingConfig
};
