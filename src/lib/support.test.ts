import { describe, expect, it } from 'vitest';
import { DONATION_ADDRESSES, isValidBech32, isValidEvmAddress } from './support';

describe('adresses de soutien', () => {
  // Garde-fou : une faute de frappe dans une adresse ferait perdre les dons.
  it('chaque adresse est valide pour son réseau', () => {
    for (const a of DONATION_ADDRESSES) {
      const valid = a.id === 'btc' ? isValidBech32(a.address) : isValidEvmAddress(a.address);
      expect(valid, `${a.label} : ${a.address}`).toBe(true);
    }
  });

  it('le QR code contient l’adresse affichée', () => {
    for (const a of DONATION_ADDRESSES) expect(a.qr.endsWith(a.address)).toBe(true);
  });

  it('détecte une faute de frappe', () => {
    expect(isValidBech32('bc1qd5j0yrrxp6wrk5ds0xne97hdrz5fvxjl8q22p5')).toBe(false);
    expect(isValidEvmAddress('0x7e4b6bad06813506b724b5ea3cc9545a7b97eba')).toBe(false);
  });
});
