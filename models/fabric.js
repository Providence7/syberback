import mongoose from 'mongoose';
const { Schema } = mongoose;

// ─── Material → Unit mapping ───────────────────────────────────────────────
// Single source of truth. The `unit` field is NEVER accepted from the client —
// it's always derived from `material` right before validation/save, so it
// can never drift out of sync no matter what a request body contains.
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

const FabricSchema = new Schema({
    title: { type: String, required: true, trim: true },
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
        // No default needed — always set in the pre-validate hook below.
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

// Always recompute `unit` from `material` right before validation runs —
// this fires on every save() (create AND update), so editing a fabric's
// material later also keeps its unit correct automatically.
FabricSchema.pre('validate', function (next) {
    if (this.material) {
        this.unit = getUnitForMaterial(this.material);
    }
    next();
});

export default mongoose.model('Fabric', FabricSchema);