// scripts/checkMaterialUnits.js
//
// Dry-run only — this script NEVER writes to the database. It just finds
// and prints any Style documents whose materialUnit isn't one of the
// values Fabric.unit actually uses ('cap' | 'yards' | 'trouser'), so you
// can see what needs fixing before the schema enum goes live.
//
// Run from your backend project root:
//   node scripts/checkMaterialUnits.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Style from '../models/styles.js';

dotenv.config();

async function main() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error('❌ No MONGODB_URI (or MONGO_URI) found in your .env file. Aborting.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.\n');

  const bad = await Style.find(
    { materialUnit: { $nin: ['cap', 'yards', 'trouser'] } },
    'title materialUnit category'
  );

  if (bad.length === 0) {
    console.log('✅ All styles have a valid materialUnit. Safe to deploy the schema change.');
  } else {
    console.log(`⚠️  ${bad.length} style(s) have an invalid materialUnit:\n`);
    bad.forEach(s => {
      console.log(`  "${s.title}" (${s.category}) → currently "${s.materialUnit}"`);
    });
    console.log('\nFix these before deploying the enum change, or they will fail validation on next save.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});