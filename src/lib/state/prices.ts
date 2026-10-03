/** Source de prix partagée (cache commun à toute la session). */
import { BinancePrices } from '../prices/binance';

export const prices = new BinancePrices();
