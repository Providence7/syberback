// src/controllers/fabricController.js (Fixed version)
import Fabric from '../models/fabric.js';
import { v2 as cloudinary } from 'cloudinary';

// Helper to extract public_id from Cloudinary URL (if not stored in DB)
const getPublicIdFromUrl = (imageUrl) => {
    if (!imageUrl) return null;
    const parts = imageUrl.split('/');
    const filename = parts[parts.length - 1];
    return filename.substring(0, filename.lastIndexOf('.'));
};

// @route   POST /api/fabrics
// @desc    Add a new fabric (Admin only)
// @access  Private (Admin)
export const addFabric = async (req, res) => {
    const {
        title, material, color, quality, price, description,
        details, width, weight, care, tags
    } = req.body;

    const uploadedImage = req.file; // Contains Cloudinary response from multer-storage-cloudinary

    try {
        if (!uploadedImage) {
            return res.status(400).json({ msg: 'No image file uploaded or upload failed.' });
        }

        // Check if a fabric with the same title already exists
        const existingFabric = await Fabric.findOne({ title });
        if (existingFabric) {
            // If an image was uploaded, delete it from Cloudinary before sending error
            try {
                await cloudinary.uploader.destroy(uploadedImage.filename);
            } catch (deleteError) {
                console.error('Error deleting uploaded image:', deleteError);
            }
            return res.status(400).json({ msg: 'A fabric with this title already exists.' });
        }

        // Process tags - handle both string and array formats
        let processedTags = [];
        if (tags) {
            if (typeof tags === 'string') {
                processedTags = tags.split(',').map(item => item.trim()).filter(item => item !== '');
            } else if (Array.isArray(tags)) {
                processedTags = tags.filter(item => item && item.trim() !== '');
            }
        }

        const newFabric = new Fabric({
            title,
            material,
            color,
            quality,
            price: Number(price),
            image: uploadedImage.path, // Cloudinary secure_url
            cloudinary_id: uploadedImage.filename, // Store the Cloudinary public_id
            description,
            details,
            width,
            weight,
            care,
            tags: processedTags,
            addedBy: req.user.id // Assuming req.user.id is populated by your auth middleware
        });

        const fabric = await newFabric.save();
        res.status(201).json({
            success: true,
            message: 'Fabric added successfully',
            data: fabric
        });
    } catch (err) {
        console.error('Error adding fabric:', err.message);
        // If an image was uploaded but saving to DB failed, delete it from Cloudinary
        if (uploadedImage && uploadedImage.filename) {
            try {
                await cloudinary.uploader.destroy(uploadedImage.filename);
            } catch (deleteError) {
                console.error('Error deleting uploaded image after save failure:', deleteError);
            }
        }
        if (err.name === 'ValidationError') {
            const errors = {};
            for (let field in err.errors) {
                errors[field] = err.errors[field].message;
            }
            return res.status(400).json({ 
                msg: 'Validation failed', 
                errors: errors, 
                message: err.message 
            });
        }
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET /api/fabrics
// @desc    Get all fabrics
// @access  Public
export const getFabrics = async (req, res) => {
    try {
        const fabrics = await Fabric.find().sort({ createdAt: -1 });
        res.json({
            success: true,
            count: fabrics.length,
            data: fabrics
        });
    } catch (err) {
        console.error('Error fetching fabrics:', err.message);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET /api/fabrics/:id
// @desc    Get fabric by ID
// @access  Public
export const getFabricById = async (req, res) => {
    try {
        const fabric = await Fabric.findById(req.params.id);
        if (!fabric) {
            return res.status(404).json({ msg: 'Fabric not found' });
        }
        res.json({
            success: true,
            data: fabric
        });
    } catch (err) {
        console.error('Error fetching fabric:', err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Fabric not found' });
        }
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PUT /api/fabrics/:id
// @desc    Update a fabric (Admin only), with optional image upload
// @access  Private (Admin)
export const updateFabric = async (req, res) => {
    const {
        title, material, color, quality, price, description,
        details, width, weight, care, tags
    } = req.body;

    const uploadedImage = req.file; // Contains Cloudinary response from multer-storage-cloudinary

    try {
        let fabric = await Fabric.findById(req.params.id);

        if (!fabric) {
            if (uploadedImage && uploadedImage.filename) {
                try {
                    await cloudinary.uploader.destroy(uploadedImage.filename);
                } catch (deleteError) {
                    console.error('Error deleting uploaded image:', deleteError);
                }
            }
            return res.status(404).json({ msg: 'Fabric not found' });
        }

        // 1. Update image and cloudinary_id ONLY if a new image is uploaded
        if (uploadedImage) {
            // Delete old image from Cloudinary if it exists
            if (fabric.cloudinary_id) {
                try {
                    await cloudinary.uploader.destroy(fabric.cloudinary_id);
                } catch (deleteError) {
                    console.error('Error deleting old image:', deleteError);
                }
            } else if (fabric.image) {
                // Fallback for old fabrics that might not have cloudinary_id
                const oldPublicId = getPublicIdFromUrl(fabric.image);
                if (oldPublicId) {
                    try {
                        await cloudinary.uploader.destroy(oldPublicId);
                    } catch (deleteError) {
                        console.error('Error deleting old image (fallback):', deleteError);
                    }
                }
            }
            fabric.image = uploadedImage.path;
            fabric.cloudinary_id = uploadedImage.filename;
        }

        // 2. Update other text fields only if they are provided in the request body
        if (title !== undefined) fabric.title = title;
        if (material !== undefined) fabric.material = material;
        if (color !== undefined) fabric.color = color;
        if (quality !== undefined) fabric.quality = quality;
        if (price !== undefined) fabric.price = Number(price);
        if (description !== undefined) fabric.description = description;
        if (details !== undefined) fabric.details = details;
        if (width !== undefined) fabric.width = width;
        if (weight !== undefined) fabric.weight = weight;
        if (care !== undefined) fabric.care = care;

        // Handle tags update
        if (tags !== undefined) {
            let processedTags = [];
            if (typeof tags === 'string') {
                processedTags = tags.split(',').map(item => item.trim()).filter(item => item !== '');
            } else if (Array.isArray(tags)) {
                processedTags = tags.filter(item => item && item.trim() !== '');
            }
            fabric.tags = processedTags;
        }

        const updatedFabric = await fabric.save();
        res.json({
            success: true,
            message: 'Fabric updated successfully',
            data: updatedFabric
        });
    } catch (err) {
        console.error('Error updating fabric:', err.message);
        // If a new image was uploaded but DB update failed, delete the new image from Cloudinary
        if (uploadedImage && uploadedImage.filename) {
            try {
                await cloudinary.uploader.destroy(uploadedImage.filename);
            } catch (deleteError) {
                console.error('Error deleting uploaded image after update failure:', deleteError);
            }
        }
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Fabric not found' });
        }
        if (err.name === 'ValidationError') {
            const errors = {};
            for (let field in err.errors) {
                errors[field] = err.errors[field].message;
            }
            return res.status(400).json({ 
                msg: 'Validation failed', 
                errors: errors, 
                message: err.message 
            });
        }
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   DELETE /api/fabrics/:id
// @desc    Delete a fabric (Admin only)
// @access  Private (Admin)
export const deleteFabric = async (req, res) => {
    try {
        const fabric = await Fabric.findById(req.params.id);

        if (!fabric) {
            return res.status(404).json({ msg: 'Fabric not found' });
        }

        // Delete image from Cloudinary using the stored public_id
        if (fabric.cloudinary_id) {
            try {
                await cloudinary.uploader.destroy(fabric.cloudinary_id);
            } catch (deleteError) {
                console.error('Error deleting image from Cloudinary:', deleteError);
            }
        } else if (fabric.image) { // Fallback if cloudinary_id wasn't stored
            const publicId = getPublicIdFromUrl(fabric.image);
            if (publicId) {
                try {
                    await cloudinary.uploader.destroy(publicId);
                } catch (deleteError) {
                    console.error('Error deleting image from Cloudinary (fallback):', deleteError);
                }
            }
        }

        await Fabric.findByIdAndDelete(req.params.id);

        res.json({ 
            success: true,
            message: 'Fabric deleted successfully' 
        });
    } catch (err) {
        console.error('Error deleting fabric:', err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Fabric not found' });
        }
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};