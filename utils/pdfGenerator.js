import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import fs from 'fs';
import path from 'path';

// Replace with your actual logo path
const logoPath = path.resolve('public/logo.png');

/**
 * Generates a PDF receipt and returns it as a buffer.
 * @param {Object} order - Order object with all necessary details
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateReceiptPDF(order) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  let buffers = [];

  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  // Header
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 45, { width: 100 });
  }
  doc.fontSize(20).text('Order Receipt', 200, 50, { align: 'right' });
  doc.moveDown();

  // Customer Info
  doc.fontSize(12).text(`Customer: ${order.user?.name || 'N/A'}`);
  doc.text(`Email: ${order.user?.email || 'N/A'}`);
  if (order.user?.phone) doc.text(`Phone: ${order.user.phone}`);
  if (order.user?.address) doc.text(`Address: ${order.user.address}`);
  doc.text(`Order ID: ${order._id}`);
  doc.text(`Order Date: ${new Date(order.orderDate).toLocaleDateString()}`);
  doc.moveDown();

  // Style Info
  doc.fontSize(14).text('Style Details', { underline: true });
  doc.fontSize(12);
  doc.text(`Title: ${order.styleTitle}`);
  doc.text(`Price: $${order.stylePrice.toFixed(2)}`);
  doc.text(`Source: ${order.styleSource}`);
  doc.moveDown();

  // Material Info
  doc.fontSize(14).text('Material Details', { underline: true });
  doc.fontSize(12);
  doc.text(`Source: ${order.materialSource}`);
  if (order.materialTitle) doc.text(`Title: ${order.materialTitle}`);
  if (order.materialColor) doc.text(`Color: ${order.materialColor}`);
  doc.text(`Price: $${order.materialPrice.toFixed(2)}`);
  doc.moveDown();

  // Other Info
  doc.fontSize(14).text('Other Info', { underline: true });
  doc.fontSize(12);
  doc.text(`Measurement ID: ${order.measurement?._id || 'N/A'}`);
  if (order.note) doc.text(`Note: ${order.note}`);
  doc.text(`Status: ${order.status}`);
  doc.text(`Estimated Delivery: ${new Date(order.estimatedDelivery).toLocaleDateString()}`);
  if (order.actualDelivery)
    doc.text(`Actual Delivery: ${new Date(order.actualDelivery).toLocaleDateString()}`);
  doc.moveDown();

  // Total
  doc.fontSize(14).text(`Total Price: $${order.totalPrice.toFixed(2)}`, {
    align: 'right',
  });

  doc.end();
  return await getStream.buffer(doc);
}
