// Test current Jupiter API endpoints
import axios from 'axios';

async function testJupiterQuote() {
  console.log('\n🧪 Testing Jupiter Quote API...');
  try {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 1000000000, // 1 SOL (9 decimals)
        slippageBps: 50
      },
      timeout: 10000
    });
    
    console.log('✅ Quote API works!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log('❌ Quote API failed:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', error.response.data);
    }
    return false;
  }
}

async function testBirdeye() {
  console.log('\n🧪 Testing Birdeye API (no key)...');
  try {
    const response = await axios.get('https://public-api.birdeye.so/public/price', {
      params: {
        address: 'So11111111111111111111111111111111111111112'
      },
      timeout: 10000
    });
    
    console.log('✅ Birdeye works!');
    console.log('Price:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Birdeye failed:', error.message);
    return false;
  }
}

async function testDexScreener() {
  console.log('\n🧪 Testing DexScreener API (free)...');
  try {
    const response = await axios.get('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', {
      timeout: 10000
    });
    
    console.log('✅ DexScreener works!');
    console.log('Pairs found:', response.data.pairs?.length || 0);
    if (response.data.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      console.log('Example pair:', {
        dex: pair.dexId,
        price: pair.priceUsd,
        baseToken: pair.baseToken.symbol,
        quoteToken: pair.quoteToken.symbol
      });
    }
    return true;
  } catch (error) {
    console.log('❌ DexScreener failed:', error.message);
    return false;
  }
}

async function testCoinGecko() {
  console.log('\n🧪 Testing CoinGecko API (free)...');
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'solana,raydium,bonk',
        vs_currencies: 'usd'
      },
      timeout: 10000
    });
    
    console.log('✅ CoinGecko works!');
    console.log('Prices:', response.data);
    return true;
  } catch (error) {
    console.log('❌ CoinGecko failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing Available Price APIs...\n');
  
  const results = {
    jupiterQuote: await testJupiterQuote(),
    birdeye: await testBirdeye(),
    dexScreener: await testDexScreener(),
    coinGecko: await testCoinGecko()
  };
  
  console.log('\n📊 Results:');
  console.log('Jupiter Quote:', results.jupiterQuote ? '✅' : '❌');
  console.log('Birdeye:', results.birdeye ? '✅' : '❌');
  console.log('DexScreener:', results.dexScreener ? '✅' : '❌');
  console.log('CoinGecko:', results.coinGecko ? '✅' : '❌');
  
  console.log('\n💡 Recommendation:');
  if (results.dexScreener) {
    console.log('Use DexScreener - provides DEX-specific prices for free!');
  } else if (results.birdeye) {
    console.log('Use Birdeye - good price data');
  } else if (results.coinGecko) {
    console.log('Use CoinGecko - works but only aggregate prices (not ideal for arbitrage)');
  } else {
    console.log('All APIs failed. Check network connectivity.');
  }
}

runTests().catch(console.error);
