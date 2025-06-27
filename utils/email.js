import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
console.log('SMTP_HOST:', process.env.SMTP_HOST);

export function sendEmail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.SMTP_USER,
    to, subject, html,
  });
  
}
