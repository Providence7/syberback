// src/utils/email.js
import SibApiV3Sdk from 'sib-api-v3-sdk';
import dotenv from 'dotenv';
dotenv.config();

// Configure Brevo API client
const client = SibApiV3Sdk.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Send an email using Brevo API
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML content
 */
export async function sendEmail({ to, subject, html }) {
  try {
    const sendSmtpEmail = {
      to: [{ email: to }],
      sender: { 
        email: process.env.BREVO_FROM_EMAIL || "no-reply@syber.onrender.com",
        name: "SyberTailor"
      },
      subject,
      htmlContent: html,
    };

    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Email sent to ${to}:`, response.messageId || response);
    return response;
  } catch (error) {
    console.error("❌ Failed to send email:", error);
    throw error;
  }
}
