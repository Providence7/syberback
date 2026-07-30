// src/controllers/fabricController.js
import Fabric, { FABRIC_CATEGORIES } from '../models/fabric.js';
import { v2 as cloudinary } from 'cloudinary';
import { broadcastNotification } from '../utils/notifyUsers.js';
import User from '../models/user.js';

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
        title, category, material, color, quality, price, description,
        details, width, weight, care, tags
    } = req.body;

    const uploadedImage = req.file;

    try {
        if (!uploadedImage) {
            return res.status(400).json({ msg: 'No image file uploaded or upload failed.' });
        }

        if (!FABRIC_CATEGORIES.includes(category)) {
            try { await cloudinary.uploader.destroy(uploadedImage.filename); } catch {}
            return res.status(400).json({ msg: `Invalid category. Must be one of: ${FABRIC_CATEGORIES.join(', ')}` });
        }

        const existingFabric = await Fabric.findOne({ title });
        if (existingFabric) {
            try {
                await cloudinary.uploader.destroy(uploadedImage.filename);
            } catch (deleteError) {
                console.error('Error deleting uploaded image:', deleteError);
            }
            return res.status(400).json({ msg: 'A fabric with this title already exists.' });
        }

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
            category,
            material,
            color,
            quality,
            price: Number(price),
            image: uploadedImage.path,
            cloudinary_id: uploadedImage.filename,
            description,
            details,
            width,
            weight,
            care,
            tags: processedTags,
            addedBy: req.user.id
        });

        const fabric = await newFabric.save();
        try {
            const io = req.app.get('io');
            const users = await User.find({}, '_id');
            await broadcastNotification(io, users.map(u => u._id), {
                title:    '🧵 New Material Available',
                message:  `"${fabric.title}" has been added to our materials catalogue.`,
                type:     'info',
                category: 'material',
            });
        } catch (notifErr) {
            console.error('Notification error (non-blocking):', notifErr.message);
        }
        res.status(201).json({
            success: true,
            message: 'Fabric added successfully',
            data: fabric
        });
    } catch (err) {
        console.error('Error adding fabric:', err.message);
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

// @route   POST /api/fabrics/bulk
// @desc    Bulk-create fabrics from an array of { title, category, ..., imageUrl }
// @access  Private (Admin)
export const bulkCreateFabrics = async (req, res) => {
    const { fabrics } = req.body;

    if (!Array.isArray(fabrics) || fabrics.length === 0) {
        return res.status(400).json({ msg: 'Request body must include a non-empty "fabrics" array.' });
    }

    const saved = [];
    const failed = [];
    const seenTitles = new Set();

    for (const item of fabrics) {
        const {
            title, category, material, color, quality, price, description,
            details, width, weight, care, tags, imageUrl
        } = item || {};

        try {
            if (!title || !price || !description || !details || !width || !imageUrl) {
                throw new Error('Missing required field(s): title, price, width, description, details, or imageUrl.');
            }
            if (!category || !FABRIC_CATEGORIES.includes(category)) {
                throw new Error(`Invalid or missing category. Must be one of: ${FABRIC_CATEGORIES.join(', ')}`);
            }

            if (seenTitles.has(title)) {
                throw new Error('Duplicate title within this batch.');
            }

            const existingFabric = await Fabric.findOne({ title });
            if (existingFabric) {
                throw new Error('A fabric with this title already exists.');
            }

            const uploadResult = await cloudinary.uploader.upload(imageUrl, {
                folder: 'fabrics',
            });

            let processedTags = [];
            if (tags) {
                if (typeof tags === 'string') {
                    processedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
                } else if (Array.isArray(tags)) {
                    processedTags = tags.filter(t => t && t.trim() !== '');
                }
            }

            const newFabric = new Fabric({
                title,
                category,
                material,
                color,
                quality,
                price: Number(price),
                image: uploadResult.secure_url,
                cloudinary_id: uploadResult.public_id,
                description,
                details,
                width,
                weight,
                care,
                tags: processedTags,
                addedBy: req.user.id,
            });

            const fabricDoc = await newFabric.save();
            seenTitles.add(title);
            saved.push({ title: fabricDoc.title, id: fabricDoc._id });

        } catch (err) {
            console.error(`Bulk upload failed for "${title}":`, err.message);
            failed.push({ title, error: err.message });
        }
    }

    if (saved.length > 0) {
        try {
            const io = req.app.get('io');
            const users = await User.find({}, '_id');
            await broadcastNotification(io, users.map(u => u._id), {
                title:    '🧵 New Materials Available',
                message:  `${saved.length} new fabric${saved.length !== 1 ? 's' : ''} added to our materials catalogue.`,
                type:     'info',
                category: 'material',
            });
        } catch (notifErr) {
            console.error('Notification error (non-blocking):', notifErr.message);
        }
    }

    res.status(saved.length > 0 ? 201 : 400).json({
        success: failed.length === 0,
        saved,
        failed,
    });
};

// @route   GET /api/fabrics
// @desc    Get all fabrics, optionally filtered by ?category=
// @access  Public
export const getFabrics = async (req, res) => {
    try {
        const { category } = req.query;
        const filter = category ? { category } : {};
        const fabrics = await Fabric.find(filter).sort({ createdAt: -1 });
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
// @access  Private (Admin)
export const updateFabric = async (req, res) => {
    const {
        title, category, material, color, quality, price, description,
        details, width, weight, care, tags
    } = req.body;

    const uploadedImage = req.file;

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

        if (category !== undefined && !FABRIC_CATEGORIES.includes(category)) {
            return res.status(400).json({ msg: `Invalid category. Must be one of: ${FABRIC_CATEGORIES.join(', ')}` });
        }

        if (uploadedImage) {
            if (fabric.cloudinary_id) {
                try {
                    await cloudinary.uploader.destroy(fabric.cloudinary_id);
                } catch (deleteError) {
                    console.error('Error deleting old image:', deleteError);
                }
            } else if (fabric.image) {
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

        if (title !== undefined) fabric.title = title;
        if (category !== undefined) fabric.category = category;
        if (material !== undefined) fabric.material = material;
        if (color !== undefined) fabric.color = color;
        if (quality !== undefined) fabric.quality = quality;
        if (price !== undefined) fabric.price = Number(price);
        if (description !== undefined) fabric.description = description;
        if (details !== undefined) fabric.details = details;
        if (width !== undefined) fabric.width = width;
        if (weight !== undefined) fabric.weight = weight;
        if (care !== undefined) fabric.care = care;

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
        try {
            const io = req.app.get('io');
            const users = await User.find({}, '_id');
            await broadcastNotification(io, users.map(u => u._id), {
                title:    '🧵 Material updated',
                message:  `"${fabric.title}" has been updated in our materials catalogue.`,
                type:     'info',
                category: 'material',
            });
        } catch (notifErr) {
            console.error('Notification error (non-blocking):', notifErr.message);
        }
        res.json({
            success: true,
            message: 'Fabric updated successfully',
            data: updatedFabric
        });
    } catch (err) {
        console.error('Error updating fabric:', err.message);
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
// @access  Private (Admin)
export const deleteFabric = async (req, res) => {
    try {
        const fabric = await Fabric.findById(req.params.id);

        if (!fabric) {
            return res.status(404).json({ msg: 'Fabric not found' });
        }

        if (fabric.cloudinary_id) {
            try {
                await cloudinary.uploader.destroy(fabric.cloudinary_id);
            } catch (deleteError) {
                console.error('Error deleting image from Cloudinary:', deleteError);
            }
        } else if (fabric.image) {
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