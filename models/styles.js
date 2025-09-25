import mongoose from 'mongoose';

const StyleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        unique: true,
        trim: true,
    },
    // The key change is here: An array of strings that can be empty.
    type: {
        type: [String],
        default: [],
    },
    gender: {
        type: String,
        required: [true, 'Gender is required'],
        enum: ['Male', 'Female', 'Unisex'],
    },
    ageGroup: {
        type: String,
        enum: ['Adult', 'Child', 'Teen', 'Elder'],
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
    },
    image: {
        type: String,
        required: true,
    },
    cloudinary_id: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    details: {
        type: String,
    },
    colour: {
        type: String,
    },
    recommendedMaterials: {
        type: [String],
        default: [],
    },
    materialQuantities: {
        type: Map,
        of: Number,
        default: {},
    },
    tags: {
        type: [String],
        default: [],
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true
});

const Style = mongoose.model('Style', StyleSchema);
export default Style;