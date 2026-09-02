const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();

// Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const driverRoutes = require('./routes/driverRoutes');
const fleetRoutes = require('./routes/fleetRoutes');
const plantRoutes = require('./routes/plantRoutes');

const adminRoutes = require('./routes/adminRoutes');
const financeRoutes = require('./routes/financeRoutes');
const brokerRoutes = require('./routes/brokerRoutes');
const settingRoutes = require('./routes/settingRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const path = require('path');

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/fleet', fleetRoutes);
app.use('/api/v1/plant', plantRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/finance', financeRoutes);
app.use('/api/v1/broker', brokerRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/upload', uploadRoutes);

// Basic Health Check Route
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'LoadAfrica Backend API is running perfectly!',
    timestamp: new Date().toISOString()
  });
});

// Fallback for 404
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    errors: process.env.NODE_ENV === 'development' ? [err.message] : []
  });
});

module.exports = app;
