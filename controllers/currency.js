// Option 1: Using exchangerate-api.com (Free, no API key needed for basic usage)
import axios from "axios";
export const getCurrencyRate = async (req, res, next) => {
  const { base = 'NGN', target = 'USD' } = req.query;

  try {
    const { data } = await axios.get(`https://api.exchangerate-api.com/v4/latest/${base}`);
    
    if (!data.rates[target]) {
      return res.status(400).json({ 
        error: `Exchange rate not found for ${base} to ${target}` 
      });
    }

    res.json({ 
      rate: data.rates[target],
      base: data.base,
      date: data.date
    });
  } catch (error) {
    console.error('Currency API Error:', error.message);
    next(new Error(`Failed to fetch exchange rate: ${error.message}`));
  }
};