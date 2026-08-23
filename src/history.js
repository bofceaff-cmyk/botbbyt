function explorerUrl(network, hash) {
  const h = String(hash || '').trim();
  if (!h) return null;
  const n = String(network || '').toUpperCase();
  if (n.includes('TRC') || n.includes('TRON') || n === 'TRX') {
    return `https://tronscan.org/#/transaction/${h}`;
  }
  if (n.includes('ERC') || n === 'ETH' || n === 'USDT-ERC20') {
    return `https://etherscan.io/tx/${h}`;
  }
  if (n === 'BTC' || n.includes('BITCOIN')) {
    return `https://mempool.space/tx/${h}`;
  }
  if (n === 'SOL' || n.includes('SOLANA')) {
    return `https://solscan.io/tx/${h}`;
  }
  return `https://tronscan.org/#/transaction/${h}`;
}

function networkLabel(network) {
  const n = String(network || '').toUpperCase();
  if (n === 'TRC20' || n === 'TRON' || n === 'TRX') return 'TRON (TRC20)';
  if (n === 'ERC20' || n === 'ETH') return 'Ethereum (ERC20)';
  if (n === 'BTC') return 'Bitcoin';
  if (n === 'SOL') return 'Solana';
  return network || '';
}

function serializeHistory(h) {
  const amount = Number(h.amount);
  const balance = Number(h.balance);
  const txHash = h.txHash || null;
  const network = h.network || null;
  return {
    id: h.id,
    type: h.type,
    amount,
    balance,
    meta: h.meta,
    createdAt: h.createdAt,
    asset: h.asset || 'USDT',
    network,
    networkLabel: networkLabel(network),
    address: h.address || null,
    txHash,
    fee: h.fee == null ? null : Number(h.fee),
    status: h.status || defaultStatus(h.type, amount),
    explorer: explorerUrl(network, txHash),
  };
}

function defaultStatus(type, amount) {
  if (String(type || '').startsWith('withdraw') || (type === 'admin_adjust' && amount < 0)) {
    return 'completed';
  }
  return 'success';
}

module.exports = { explorerUrl, networkLabel, serializeHistory, defaultStatus };
