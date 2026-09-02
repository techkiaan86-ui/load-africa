const express = require('express');
const router = express.Router();
const upload = require('../middlewares/uploadMiddleware');

// Upload single or multiple files (accepts 'file' or 'files' field names)
router.post('/', (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[Upload Error]:', err);
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const fileUrls = req.files.map(file => {
      if (file.path && (file.path.startsWith('http://') || file.path.startsWith('https://'))) {
        return file.path;
      }
      if (file.secure_url) {
        return file.secure_url;
      }
      return `/uploads/${file.filename}`;
    });
    
    return res.status(200).json({
      success: true,
      message: 'Files uploaded successfully',
      data: {
        url: fileUrls[0],
        urls: fileUrls
      }
    });
  });
});

module.exports = router;
