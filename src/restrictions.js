const MSG = require('./messages');

function banMessage(user) {
  return String(user?.banReason || '').trim() || MSG.ACCOUNT_BANNED;
}

function transfersBlocked(user) {
  return Boolean(user?.transfersDisabled || user?.opsLocked);
}

function conversionsBlocked(user) {
  return Boolean(user?.conversionsDisabled || user?.opsLocked);
}

function transferMessage(user) {
  return String(user?.transferLockReason || user?.opsLockReason || '').trim() || MSG.TRANSFERS_DISABLED;
}

function convertMessage(user) {
  return String(user?.convertLockReason || user?.opsLockReason || '').trim() || MSG.CONVERSIONS_DISABLED;
}

function rejectBanned(req, res) {
  if (!req.user?.banned) return false;
  res.status(403).json({
    error: banMessage(req.user),
    code: 'banned',
    banReason: banMessage(req.user),
  });
  return true;
}

function rejectTransfers(req, res) {
  if (rejectBanned(req, res)) return true;
  if (!transfersBlocked(req.user)) return false;
  res.status(403).json({
    error: transferMessage(req.user),
    code: 'transfers_disabled',
  });
  return true;
}

function rejectConversions(req, res) {
  if (rejectBanned(req, res)) return true;
  if (!conversionsBlocked(req.user)) return false;
  res.status(403).json({
    error: convertMessage(req.user),
    code: 'conversions_disabled',
  });
  return true;
}

/** @deprecated use rejectTransfers / rejectConversions */
function rejectOpsLocked(req, res) {
  return rejectTransfers(req, res) || rejectConversions(req, res);
}

module.exports = {
  banMessage,
  transferMessage,
  convertMessage,
  transfersBlocked,
  conversionsBlocked,
  rejectBanned,
  rejectTransfers,
  rejectConversions,
  rejectOpsLocked,
};
