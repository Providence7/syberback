// src/controllers/currencyController.js
import axios from 'axios';

// IMPORTANT: Replace with your actual API key from exchangerate-api.com
// Store this in your environment variables (e.g., in a .env file)
const EXCHANGE_RATE_API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const EXCHANGE_RATE_BASE_URL = 'https://v6.exchangerate-api.com/v6';

// Cache for exchange rates to avoid hitting the API too often
// In a production environment, consider a more robust caching mechanism (e.g., Redis)
let exchangeRateCache = {
    rate: null,
    timestamp: null,
    expiry: 1000 * 60 * 60 // Cache for 1 hour (adjust as needed)
};

// @route   GET /api/currency/exchange-rate
// @desc    Get live USD to NGN exchange rate
// @access  Public
export const getExchangeRate = async (req, res) => {
    try {
        const now = Date.now();

        // Check cache
        if (exchangeRateCache.rate && (now - exchangeRateCache.timestamp < exchangeRateCache.expiry)) {
            console.log('Serving exchange rate from cache.');
            return res.json({
                success: true,
                message: 'Exchange rate fetched from cache',
                data: {
                    USD_to_NGN: exchangeRateCache.rate,
                    source: 'cache'
                }
            });
        }

        if (!EXCHANGE_RATE_API_KEY) {
            console.error('EXCHANGE_RATE_API_KEY is not set in environment variables.');
            return res.status(500).json({ msg: 'Server configuration error: Exchange rate API key missing.' });
        }

        const url = `${EXCHANGE_RATE_BASE_URL}/${EXCHANGE_RATE_API_KEY}/pair/USD/NGN`;
        const response = await axios.get(url);

        if (response.data && response.data.result === 'success') {
            const rate = response.data.conversion_rate;
            exchangeRateCache = {
                rate: rate,
                timestamp: now,
                expiry: 1000 * 60 * 60 // Reset cache expiry
            };
            console.log('Fetched new exchange rate from API.');
            res.json({
                success: true,
                message: 'Exchange rate fetched successfully',
                data: {
                    USD_to_NGN: rate,
                    source: 'api'
                }
            });
        } else {
            console.error('Error fetching exchange rate from API:', response.data);
            res.status(500).json({ msg: 'Failed to fetch exchange rate. Invalid API response.', details: response.data });
        }
    } catch (err) {
        console.error('Error in getExchangeRate:', err.message);
        if (err.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('ExchangeRate-API response error:', err.response.data);
            res.status(err.response.status).json({
                msg: `Failed to fetch exchange rate: ${err.response.data['error-type'] || 'External API error'}`,
                details: err.response.data
            });
        } else if (err.request) {
            // The request was made but no response was received
            console.error('No response received from ExchangeRate-API:', err.request);
            res.status(500).json({ msg: 'Failed to fetch exchange rate: No response from external API.' });
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error setting up request to ExchangeRate-API:', err.message);
            res.status(500).json({ msg: 'Server error while fetching exchange rate.' });
        }
    }
};