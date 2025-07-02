import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  type: String,
  gender: String,
  ageGroup: String,
  identity: String,
  yardsRequired: Number,
  colour: String,
  recommendedMaterials: [String],
  price: Number,
  image: String,
  description: String,
  details: String,
});

export default mongoose.model('Style', styleSchema);
