const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Ensure uploads directory exists for fallback
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

let storage;

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const isDoc = ['pdf', 'doc', 'docx'].includes(ext) || file.mimetype.includes('pdf') || file.mimetype.includes('document');
      return {
        folder: 'load_africa_uploads',
        resource_type: isDoc ? 'raw' : 'auto',
        public_id: file.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1E4)
      };
    },
  });
} else {
  storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
}

// Flexible file filter
const fileFilter = (req, file, cb) => {
  if (!file.originalname) return cb(null, true);
  
  const allowedFileTypes = /jpeg|jpg|png|gif|webp|avif|pdf|doc|docx/;
  const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());

  if (extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image and document files (JPG, PNG, WEBP, AVIF, PDF, DOC) are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 15 }, // 15MB limit
  fileFilter: fileFilter
});

module.exports = upload;
