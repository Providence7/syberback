// src/controllers/measurement.js
import Measurement from '../models/measurement.js';
import User from '../models/user.js'; // Assuming you have a User model for populating
// import cloudinary from '../utils/cloudinary.js'; // Assuming you have cloudinary configured for photo deletion

export const createMeasurement = async (req, res) => {
    try {
        const photoUrl = req.file?.path || null;
        const photoPublicId = req.file?.filename || null;

        const measurement = await Measurement.create({
            name: req.body.name,
            unit: req.body.unit,
            gender: req.body.gender,
            size: req.body.size, // ADDED: Save the size from the request body
            ageBracket: req.body.ageBracket, // ADDED: Save the ageBracket from the request body
            // Data is already stringified on frontend, parse it here
            data: JSON.parse(req.body.data || '{}'), // Ensure it's an object, default to empty
            photoUrl,
            photoPublicId,
            user: req.user.id,
        });

        // Populate the user field immediately after creation to return it in the response
        const populatedMeasurement = await Measurement.findById(measurement._id).populate('user', 'name email');

        res.status(201).json(populatedMeasurement); // Return the populated measurement
    } catch (err) {
        console.error('Error creating measurement:', err);
        res.status(500).json({ error: err.message });
    }
};

// ✅ Read All (User-specific)
export const getMeasurements = async (req, res) => {
    try {
        const measurements = await Measurement.find({ user: req.user.id })
            .populate('user', 'name email') // Added population for user's own list
            .sort({ createdAt: -1 });
        res.json(measurements);
    } catch (err) {
        console.error('Error fetching user measurements:', err);
        res.status(500).json({ error: err.message });
    }
};

// ✅ Read One (User-specific)
export const getMeasurementById = async (req, res) => {
    try {
        const measurement = await Measurement.findOne({ _id: req.params.id, user: req.user.id })
            .populate('user', 'name email'); // Added population
        if (!measurement) return res.status(404).json({ error: 'Measurement not found' });
        res.json(measurement);
    } catch (err) {
        console.error('Error fetching single user measurement:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        res.status(500).json({ error: err.message });
    }
};

// ✅ Update (User-specific)
export const updateMeasurement = async (req, res) => {
    try {
        const update = {
            name: req.body.name,
            unit: req.body.unit,
            gender: req.body.gender,
            size: req.body.size, // ADDED: Update the size
            ageBracket: req.body.ageBracket, // ADDED: Update the ageBracket
            data: JSON.parse(req.body.data || '{}'), // Parse data, default to empty object
        };

        let oldMeasurement; // To potentially get old photoPublicId for deletion

        if (req.file) {
            oldMeasurement = await Measurement.findOne({ _id: req.params.id, user: req.user.id }).select('photoPublicId');
            if (oldMeasurement && oldMeasurement.photoPublicId) {
                // TODO: Uncomment and implement actual Cloudinary deletion if setup
                // await cloudinary.uploader.destroy(oldMeasurement.photoPublicId);
            }
            update.photoUrl = req.file.path;
            update.photoPublicId = req.file.filename;
        }

        const measurement = await Measurement.findOneAndUpdate(
            { _id: req.params.id, user: req.user.id },
            update,
            { new: true, runValidators: true }
        ).populate('user', 'name email'); // Added population

        if (!measurement) return res.status(404).json({ error: 'Measurement not found' });

        res.json(measurement);
    } catch (err) {
        console.error('Error updating user measurement:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(error => error.message);
            return res.status(400).json({ message: 'Validation failed', errors });
        }
        res.status(500).json({ error: err.message });
    }
};

// ✅ Delete (User-specific)
export const deleteMeasurement = async (req, res) => {
    try {
        const measurement = await Measurement.findOneAndDelete({
            _id: req.params.id,
            user: req.user.id
        });

        if (!measurement) return res.status(404).json({ error: 'Measurement not found' });

        // Optional: Delete photo from Cloudinary when measurement is deleted
        // if (measurement.photoPublicId) {
        //     // TODO: Uncomment and implement actual Cloudinary deletion if setup
        //     // await cloudinary.uploader.destroy(measurement.photoPublicId);
        // }

        res.json({ message: 'Measurement deleted' });
    } catch (err) {
        console.error('Error deleting user measurement:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        res.status(500).json({ error: err.message });
    }
};

// User-specific: check if user has any measurements
export const checkUserMeasurements = async (req, res) => {
    try {
        const userId = req.user.id;
        const hasMeasurement = await Measurement.findOne({ user: userId });
        return res.status(200).json({ hasMeasurement: !!hasMeasurement });
    } catch (error) {
        console.error('Error checking user measurements:', error);
        return res.status(500).json({ message: 'Server error checking measurements' });
    }
};

// @desc      Get all measurements (Admin only) with filters and pagination
// @route     GET /api/measurements/admin
export const getAdminMeasurements = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            searchTerm,
            gender,
            unit
        } = req.query;

        let query = {};
        if (gender && gender !== 'All') query.gender = gender;
        if (unit && unit !== 'All') query.unit = unit;

        if (searchTerm) {
            const matchingUsers = await User.find({
                $or: [
                    { name: { $regex: searchTerm, $options: 'i' } },
                    { email: { $regex: searchTerm, $options: 'i' } },
                ]
            }).select('_id');

            const userIds = matchingUsers.map(user => user._id);

            query.$or = [
                { name: { $regex: searchTerm, $options: 'i' } },
                { _id: new RegExp(searchTerm, 'i') },
                { size: { $regex: searchTerm, $options: 'i' } }, // ADDED: Search by size
                { ageBracket: { $regex: searchTerm, $options: 'i' } }, // ADDED: Search by age
            ];

            if (userIds.length > 0) {
                query.$or.push({ user: { $in: userIds } });
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Fetch measurements, but also include the 'user' field so we can check if it populated
        const measurementsWithPopulatedUser = await Measurement.find(query)
            .populate('user', 'name email') // Attempt to populate user data
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const cleanedMeasurements = [];
        const measurementsToDeleteIds = [];

        // Iterate through fetched measurements to check for orphaned users
        for (const m of measurementsWithPopulatedUser) {
            if (m.user === null) { // If populate returned null, it means the user was not found
                measurementsToDeleteIds.push(m._id);
            } else {
                cleanedMeasurements.push(m);
            }
        }

        // Delete orphaned measurements outside the loop
        if (measurementsToDeleteIds.length > 0) {
            console.warn(`Deleting ${measurementsToDeleteIds.length} orphaned measurements.`);
            await Measurement.deleteMany({ _id: { $in: measurementsToDeleteIds } });

            // Optional: Log/delete photos from Cloudinary for these deleted measurements
            // const deletedMeasurementDocs = await Measurement.find({ _id: { $in: measurementsToDeleteIds } }).select('photoPublicId');
            // for (const doc of deletedMeasurementDocs) {
            //     if (doc.photoPublicId) {
            //         // await cloudinary.uploader.destroy(doc.photoPublicId);
            //         console.log(`Deleted orphaned photo from Cloudinary: ${doc.photoPublicId}`);
            //     }
            // }
        }

        // Recalculate total measurements after deletion (important for pagination)
        const totalMeasurements = await Measurement.countDocuments(query);

        res.status(200).json({
            measurements: cleanedMeasurements, // Return only the valid ones
            totalMeasurements,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalMeasurements / parseInt(limit)),
        });

    } catch (error) {
        console.error('Error fetching all measurements (Admin):', error);
        res.status(500).json({ message: 'Server error fetching measurements.' });
    }
};

// You might also want to do this for getMeasurementById and getMeasurements
// Example for getMeasurementById:

// @desc      Get a single measurement by ID (Admin only)
// @route     GET /api/measurements/admin/:id
// @access    Private/Admin
export const getAdminMeasurementById = async (req, res) => {
    try {
        const { id } = req.params;
        const measurement = await Measurement.findById(id)
            .populate('user', 'name email'); // Changed to 'name email' for consistency, you had 'name email phone address' but frontend only displays name/email

        if (!measurement) {
            return res.status(404).json({ message: 'Measurement not found.' });
        }

        res.status(200).json({
            message: 'Measurement retrieved successfully',
            measurement
        });

    } catch (error) {
        console.error('Error fetching measurement by ID (Admin):', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        res.status(500).json({ message: 'Server error fetching measurement.' });
    }
};

// @desc      Update a measurement (Admin only)
// @route     PUT /api/measurements/admin/:id
// @access    Private/Admin
export const updateMeasurementAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, unit, gender, data, size, ageBracket } = req.body; // ADDED: size and ageBracket to destructuring

        const update = {
            name,
            unit,
            gender,
            size, // ADDED: Update the size
            ageBracket, // ADDED: Update the ageBracket
            data: JSON.parse(data || '{}'), // Parse data, default to empty object
        };

        let oldMeasurement; // To hold the existing measurement if we need to delete old photo

        if (req.file) {
            // If a new file is uploaded, we need to consider deleting the old one
            oldMeasurement = await Measurement.findById(id).select('photoPublicId');
            if (oldMeasurement && oldMeasurement.photoPublicId) {
                // TODO: Uncomment and implement actual Cloudinary deletion if setup
                // await cloudinary.uploader.destroy(oldMeasurement.photoPublicId);
                console.log(`Deleted old photo: ${oldMeasurement.photoPublicId}`); // For debugging
            }
            update.photoUrl = req.file.path;
            update.photoPublicId = req.file.filename;
        }

        const measurement = await Measurement.findByIdAndUpdate(
            id,
            update,
            { new: true, runValidators: true }
        ).populate('user', 'name email'); // IMPORTANT: Populate to return updated user data

        if (!measurement) {
            return res.status(404).json({ message: 'Measurement not found.' });
        }

        res.status(200).json({
            message: 'Measurement updated successfully',
            measurement: measurement
        });

    } catch (error) {
        console.error('Error updating measurement (Admin):', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: 'Validation failed', errors });
        }
        res.status(500).json({ message: 'Server error updating measurement.' });
    }
};

// @desc      Delete a measurement (Admin only)
// @route     DELETE /api/measurements/admin/:id
// @access    Private/Admin
export const deleteMeasurementAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const measurement = await Measurement.findByIdAndDelete(id);

        if (!measurement) {
            return res.status(404).json({ message: 'Measurement not found.' });
        }

        // Optional: Delete photo from Cloudinary when measurement is hard deleted
        if (measurement.photoPublicId) {
            // TODO: Uncomment and implement actual Cloudinary deletion if setup
            // await cloudinary.uploader.destroy(measurement.photoPublicId);
            console.log(`Deleted photo: ${measurement.photoPublicId}`); // For debugging
        }

        res.status(200).json({ message: 'Measurement deleted successfully.' });

    } catch (error) {
        console.error('Error deleting measurement (Admin):', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid measurement ID format.' });
        }
        res.status(500).json({ message: 'Server error deleting measurement.' });
    }
};
