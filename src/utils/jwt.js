const jwt = require('jsonwebtoken');

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role }, 
    process.env.JWT_SECRET || 'supersecret_fallback_key', 
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'supersecret_fallback_key');
};

module.exports = { generateToken, verifyToken };
