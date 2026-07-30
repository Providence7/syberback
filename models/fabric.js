import mongoose from 'mongoose';
import { CATEGORIES } from './constants/catergories.js';
const { Schema } = mongoose;

export const MATERIAL_UNIT_MAP = {
    'Aso oke': 'cap',
    'Adire':   'yards',
    'Batik':   'yards',
    'Kente':   'yards',
    'Lace':    'yards',
    'Wool':    'trouser',
    'cotton':  'trouser',
    'Other':   'trouser',
};

export const getUnitForMaterial = (material) => MATERIAL_UNIT_MAP[material] || 'trouser';

// Re-exported so fabric.js consumers don't need a second import for the taxonomy.
export const FABRIC_CATEGORIES = CATEGORIES;

const FabricSchema = new Schema({
    title: { type: String, required: true, trim: true },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: {
            values: CATEGORIES,
            message: '{VALUE} is not a valid category',
        },
    },
    material: {
        type: String,
        required: true,
        enum: ['Aso oke', 'Adire', 'Batik', 'Wool', 'cotton', 'Kente', 'Lace', 'Other'],
        default: 'Cotton'
    },
    unit: {
        type: String,
        required: true,
        enum: ['cap', 'yards', 'trouser'],
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
    image: { type: String, required: true },
    cloudinary_id: { type: String, required: true },
    description: { type: String, required: true },
    details: { type: String, required: true },
    width: { type: String, required: true, trim: true },
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
    tags: [String],
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

FabricSchema.index({ category: 1 });

FabricSchema.pre('validate', function (next) {
    if (this.material) {
        this.unit = getUnitForMaterial(this.material);
    }
    next();
});

export default mongoose.model('Fabric', FabricSchema);