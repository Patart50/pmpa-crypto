/**
 * Auteur et moyens de soutien : source unique, réutilisable telle quelle
 * dans les autres outils du programme (dca-crypto…).
 *
 * Adresses dédiées aux dons, distinctes des wallets personnels de l'auteur.
 * Vérifiées : checksum bech32 (Bitcoin), format 0x + 40 hexadécimaux (EVM).
 */

export const AUTHOR = {
  name: 'Arnaud',
  handle: 'Patart50',
  url: 'https://github.com/Patart50',
} as const;

export const SPONSORS_URL = 'https://github.com/sponsors/Patart50';

export interface DonationAddress {
  id: string;
  label: string;
  /** Réseaux et jetons acceptés, affichés sous l'adresse. */
  networks: string;
  address: string;
  /** Contenu du QR code (URI de paiement quand le format est universel). */
  qr: string;
  /** Avertissement affiché sous l'adresse. */
  warning: string;
}

export const DONATION_ADDRESSES: readonly DonationAddress[] = [
  {
    id: 'btc',
    label: 'Bitcoin',
    networks: 'Réseau Bitcoin uniquement (BTC)',
    address: 'bc1qd5j0yrrxp6wrk5ds0xne97hdrz5fvxjl8q22p4',
    qr: 'bitcoin:bc1qd5j0yrrxp6wrk5ds0xne97hdrz5fvxjl8q22p4',
    warning: 'N’envoyez pas de BTC via Lightning ni de BTC « wrappés » sur un autre réseau.',
  },
  {
    id: 'evm',
    label: 'Ethereum et réseaux EVM',
    networks: 'ETH, USDC… sur Ethereum, Arbitrum, Optimism, Base ou autre réseau compatible EVM',
    address: '0x7e4b6bad06813506b724b5ea3cc9545a7b97eba4',
    qr: '0x7e4b6bad06813506b724b5ea3cc9545a7b97eba4',
    warning: 'Adresse 0x uniquement : pas de réseau non EVM (Solana, Tron, Bitcoin…).',
  },
];

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** Vérifie le checksum d'une adresse Bitcoin bech32 (segwit v0). */
export function isValidBech32(address: string): boolean {
  const lower = address.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1 || sep + 7 > lower.length || lower.length > 90) return false;
  const hrp = lower.slice(0, sep);
  const data = [...lower.slice(sep + 1)].map((c) => BECH32.indexOf(c));
  if (data.includes(-1)) return false;
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i];
  }
  return chk === 1;
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}
