// email.js
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Nodemailer-style transporter mock
export const transporter = {
  verify: (cb) => {
    if (!process.env.RESEND_API_KEY) {
      const err = new Error("Missing RESEND_API_KEY");
      console.error("SMTP connection error:", err);
      cb(err, null);
    } else {
      console.log("Resend API key loaded, ready to send.");
      cb(null, true);
    }
  },
};

// Nodemailer-style sendEmail wrapper
export async function sendEmail({ to, subject, html }) {
  try {
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
      to,
      subject,
      html,
    });

    // Mimic Nodemailer sendMail success return
    return {
      accepted: [to],
      rejected: [],
      response: "250 Message queued by Resend",
      messageId: response?.id || null,
    };
  } catch (error) {
    // Mimic Nodemailer error logging
    console.error("SMTP connection error:", error);
    throw {
      code: error.code || "ESENDFAIL",
      command: "SEND",
      message: error.message || "Failed to send email via Resend",
    };
  }
}
