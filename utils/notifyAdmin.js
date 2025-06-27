const notifyAdmin = async ({ user, order, reason }) => {
  // Simulate notification logic
  console.log(`🔔 Admin Notification 🔔`);
  console.log(`User: ${user.email}`);
  console.log(`Order ID: ${order._id}`);
  console.log(`Reason: ${reason}`);

  // Placeholder: Email
  console.log(`📧 Email sent to admin: "Order ${order._id} requires manual review."`);

  // Placeholder: WhatsApp
  console.log(`📱 WhatsApp message sent to admin.`);

  // Placeholder: Client app notification
  console.log(`🛎️ Notification queued for admin dashboard.`);

  return true;
};

export default notifyAdmin;
