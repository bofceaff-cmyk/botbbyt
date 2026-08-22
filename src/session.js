const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function issueSession(prisma, userId) {
  const token = newToken();
  await prisma.user.update({
    where: { id: userId },
    data: { sessionTokenHash: hashToken(token) },
  });
  return token;
}

async function clearSession(prisma, userId, bumpEpoch = false) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const data = { sessionTokenHash: null, totpTempTokenHash: null, totpTempExpires: null };
  if (bumpEpoch) data.authEpoch = Number(user.authEpoch || 0) + 1;
  return prisma.user.update({ where: { id: userId }, data });
}

function sessionMatches(user, token) {
  if (!user || !token || !user.sessionTokenHash) return false;
  const a = Buffer.from(user.sessionTokenHash);
  const b = Buffer.from(hashToken(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashToken, newToken, issueSession, clearSession, sessionMatches };
