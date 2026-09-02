const { verifyToken } = require('../utils/jwt');
const { prisma } = require('../config/db');

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    const user = await prisma.user.findUnique({ 
      where: { id: decoded.id },
      include: { customer: true, driver: true, broker: true, fleet_owner: true }
    });
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Block only explicitly disabled accounts
    const blockedStatuses = ['SUSPENDED', 'BANNED', 'DELETED'];
    if (blockedStatuses.includes(user.status)) {
      return res.status(403).json({ success: false, message: 'Account is suspended or disabled' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

const softAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      const user = await prisma.user.findUnique({ 
        where: { id: decoded.id },
        include: { customer: true, driver: true, broker: true, fleet_owner: true }
      });
      const blockedStatuses = ['SUSPENDED', 'BANNED', 'DELETED'];
      if (user && !blockedStatuses.includes(user.status)) {
        req.user = user;
      }
    }
  } catch (error) {
    // Ignore invalid token for soft auth
  }
  next();
};

module.exports = { requireAuth, requireRole, softAuth };
