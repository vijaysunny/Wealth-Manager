import { fetchCachedJson } from './PriceCache';
// utils/InvestmentApi.js

// 1. MUTUAL FUNDS (Existing)
export const fetchMutualFundNAV = async (schemeCode) => {
  try {
    const json = await fetchCachedJson(`https://api.mfapi.in/mf/${schemeCode}`);
    if (json.status === 'SUCCESS' && json.data.length > 0) {
      return {
        name: json.meta.fund_house + ' - ' + json.meta.scheme_name,
        currentNav: parseFloat(json.data[0].nav),
        date: json.data[0].date,
      };
    }
    return null;
  } catch (error) {
    console.log('Error fetching MF NAV:', error);
    return null;
  }
};

// 2. STOCKS & GOLD/SILVER (New)
export const fetchStockPrice = async (symbol) => {
  try {
    // Yahoo Finance V8 Endpoint (Free & Public)
    // Suffix .NS for NSE (e.g., RELIANCE.NS) or .BO for BSE
    const json = await fetchCachedJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    );

    if (json.chart && json.chart.result && json.chart.result.length > 0) {
      const meta = json.chart.result[0].meta;
      const price = meta.regularMarketPrice; // Live Price
      const prevClose = meta.previousClose;

      return {
        symbol: meta.symbol,
        name: meta.symbol, // Yahoo doesn't always send full name in this light endpoint
        price: parseFloat(price),
        change: parseFloat(price - prevClose),
        changePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      };
    }
    return null;
  } catch (error) {
    console.log('Error fetching Stock Price:', error);
    return null;
  }
};
