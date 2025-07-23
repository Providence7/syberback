import mongoose from 'mongoose';
const { Schema } = mongoose;

const FabricSchema = new Schema({
    title: { type: String, required: true, trim: true },
    material: {
        type: String,
        required: true,
        enum: ['Cotton', 'Silk', 'Linen', 'Wool', 'Polyester', 'Rayon', 'Satin', 'Velvet', 'Other'],
        default: 'Cotton'
    },
    color: {
        type: String,
        required: true,
        enum: ['Red', 'Blue', 'Green', 'Yellow', 'Black', 'White', 'Patterned', 'Mixed', 'Purple', 'Orange', 'Pink', 'Brown', 'Gray', 'Other'],
        default: 'Mixed'
    },
    quality: {
        type: String,
        required: true,
        enum: ['High', 'Medium', 'Low'],
        default: 'Medium'
    },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, required: true }, // Cloudinary URL
    cloudinary_id: { type: String, required: true }, // Cloudinary public ID for deletion
    description: { type: String, required: true },
    details: { type: String, required: true },
    width: { type: String, required: true, trim: true }, // e.g., "45 inches", "150 cm"
    weight: {
        type: String,
        required: true,
        enum: ['Light', 'Medium', 'Heavy'],
        default: 'Medium'
    },
    care: {
        type: String,
        required: true,
        enum: ['Machine washable', 'Hand wash', 'Dry clean only', 'Spot clean', 'Other'],
        default: 'Machine washable'
    },
    tags: [String], // Array of strings, e.g., ['fashionable', 'versatile', 'high-quality']
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('Fabric', FabricSchema);