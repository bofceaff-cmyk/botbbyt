const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'kyc');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const type = String(req.params.type || 'doc').replace(/[^a-z_]/gi, '');
    cb(null, `u${req.user.id}_${type}_${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error('только JPG, PNG или WEBP'));
    }
    cb(null, true);
  },
});

function absolutePath(filename) {
  return path.join(UPLOAD_ROOT, filename);
}

module.exports = { upload, absolutePath, UPLOAD_ROOT, ensureUploadDir };
