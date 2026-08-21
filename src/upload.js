const fs = require('fs');
const path = require('path');
const multer = require('multer');

const KYC_ROOT = path.join(__dirname, '..', '..', 'uploads', 'kyc');
const SUPPORT_ROOT = path.join(__dirname, '..', '..', 'uploads', 'support');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(KYC_ROOT);
    cb(null, KYC_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const type = String(req.params.type || 'doc').replace(/[^a-z_]/gi, '');
    cb(null, `u${req.user.id}_${type}_${Date.now()}${safeExt}`);
  },
});

const supportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(SUPPORT_ROOT);
    cb(null, SUPPORT_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.gif'];
    const safeExt = allowed.includes(ext) ? ext : '.bin';
    const uid = req.user?.id || req.params.id || 'x';
    cb(null, `s${uid}_${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage: kycStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error('только JPG, PNG или WEBP'));
    }
    cb(null, true);
  },
});

const supportUpload = multer({
  storage: supportStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.mimetype)) {
      return cb(new Error('только фото (JPG/PNG/WEBP/GIF) или PDF'));
    }
    cb(null, true);
  },
});

function absolutePath(filename) {
  return path.join(KYC_ROOT, filename);
}

function supportAbsolutePath(filename) {
  return path.join(SUPPORT_ROOT, filename);
}

module.exports = {
  upload,
  supportUpload,
  absolutePath,
  supportAbsolutePath,
  UPLOAD_ROOT: KYC_ROOT,
  SUPPORT_ROOT,
  ensureUploadDir: () => ensureDir(KYC_ROOT),
};
